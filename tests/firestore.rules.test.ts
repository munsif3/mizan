import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const PROJECT_ID = "demo-mizan";
const HOUSEHOLD_ID = "hh_rules123";
const INVITE_CODE = `${HOUSEHOLD_ID}_invite123`;
const META_PATH = `households/${HOUSEHOLD_ID}/meta/current`;

let environment: RulesTestEnvironment;

function householdMeta() {
  return {
    id: HOUSEHOLD_ID,
    name: "Rules household",
    ownerUid: "owner",
    membersByUid: {
      owner: {
        role: "owner",
        displayName: "Owner",
        email: "owner@example.com",
        joinedAt: "2026-07-15T00:00:00.000Z",
      },
    },
    inviteCode: INVITE_CODE,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
  };
}

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"),
    },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), META_PATH), householdMeta());
  });
});

afterAll(async () => {
  await environment.cleanup();
});

describe("Firestore household authorization", () => {
  it("keeps metadata and financial snapshots private to household members", async () => {
    const outsider = environment.authenticatedContext("outsider").firestore();
    const owner = environment.authenticatedContext("owner").firestore();

    await assertFails(getDoc(doc(outsider, META_PATH)));
    await assertFails(getDoc(doc(outsider, `households/${HOUSEHOLD_ID}/snapshots/rev_1`)));
    await assertFails(getDoc(doc(outsider, `households/${HOUSEHOLD_ID}/snapshots/rev_1/efficiencyPlans/plan_1`)));
    await assertSucceeds(getDoc(doc(owner, META_PATH)));
    await assertSucceeds(setDoc(doc(owner, `households/${HOUSEHOLD_ID}/snapshots/rev_1`), { schemaVersion: 5 }));
    await assertSucceeds(setDoc(doc(owner, `households/${HOUSEHOLD_ID}/snapshots/rev_1/transactions/txn_1`), { amount: 10 }));
    await assertSucceeds(setDoc(doc(owner, `households/${HOUSEHOLD_ID}/snapshots/rev_1/efficiencyPlans/plan_1`), { action: "reduce" }));
  });

  it("permits only the invite-proven user to add itself as a regular member", async () => {
    const joiner = environment.authenticatedContext("joiner", { email: "joiner@example.com" }).firestore();
    const batch = writeBatch(joiner);
    batch.set(doc(joiner, `households/${HOUSEHOLD_ID}/joinRequests/joiner`), {
      uid: "joiner",
      inviteCode: INVITE_CODE,
      createdAt: serverTimestamp(),
    });
    batch.update(doc(joiner, META_PATH), {
      "membersByUid.joiner": {
        role: "member",
        displayName: "Joiner",
        email: "joiner@example.com",
        joinedAt: "2026-07-15T00:01:00.000Z",
      },
      updatedAt: "2026-07-15T00:01:00.000Z",
    });

    await assertSucceeds(batch.commit());
    await assertSucceeds(getDoc(doc(joiner, META_PATH)));
    await assertSucceeds(setDoc(doc(joiner, `households/${HOUSEHOLD_ID}/snapshots/rev_1/transactions/txn_1`), { amount: 10 }));
    await assertSucceeds(setDoc(doc(joiner, `households/${HOUSEHOLD_ID}/snapshots/rev_1/efficiencyPlans/plan_1`), { action: "keep" }));
  });

  it("rejects a wrong invite, privilege escalation, and metadata tampering", async () => {
    const attacker = environment.authenticatedContext("attacker").firestore();
    const wrongInvite = writeBatch(attacker);
    wrongInvite.set(doc(attacker, `households/${HOUSEHOLD_ID}/joinRequests/attacker`), {
      uid: "attacker",
      inviteCode: `${HOUSEHOLD_ID}_wrong`,
      createdAt: serverTimestamp(),
    });
    wrongInvite.update(doc(attacker, META_PATH), {
      "membersByUid.attacker": {
        role: "member",
        displayName: "Attacker",
        email: "attacker@example.com",
        joinedAt: "2026-07-15T00:01:00.000Z",
      },
      updatedAt: "2026-07-15T00:01:00.000Z",
    });
    await assertFails(wrongInvite.commit());

    const escalation = writeBatch(attacker);
    escalation.set(doc(attacker, `households/${HOUSEHOLD_ID}/joinRequests/attacker`), {
      uid: "attacker",
      inviteCode: INVITE_CODE,
      createdAt: serverTimestamp(),
    });
    escalation.update(doc(attacker, META_PATH), {
      "membersByUid.attacker": {
        role: "owner",
        displayName: "Attacker",
        email: "attacker@example.com",
        joinedAt: "2026-07-15T00:01:00.000Z",
      },
      updatedAt: "2026-07-15T00:01:00.000Z",
    });
    await assertFails(escalation.commit());
    await assertFails(updateDoc(doc(attacker, META_PATH), { name: "Hijacked" }));
  });

  it("lets an owner promote a recovery owner and transfer primary ownership", async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const meta = householdMeta();
      await setDoc(doc(context.firestore(), META_PATH), {
        ...meta,
        membersByUid: {
          ...meta.membersByUid,
          member: { role: "member", displayName: "Member", email: "member@example.com", joinedAt: "2026-07-15T00:01:00.000Z" },
        },
      });
      await setDoc(doc(context.firestore(), `users/member/households/${HOUSEHOLD_ID}`), { householdId: HOUSEHOLD_ID, role: "member" });
    });
    const owner = environment.authenticatedContext("owner").firestore();
    const outsider = environment.authenticatedContext("outsider").firestore();

    await assertSucceeds(updateDoc(doc(owner, META_PATH), {
      "membersByUid.member.role": "owner",
      ownerUid: "member",
      updatedAt: "2026-07-15T00:02:00.000Z",
    }));
    await assertFails(updateDoc(doc(outsider, META_PATH), { name: "Hijacked" }));
  });

  it("lets a non-primary user leave without changing budget data", async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const meta = householdMeta();
      await setDoc(doc(context.firestore(), META_PATH), {
        ...meta,
        membersByUid: {
          ...meta.membersByUid,
          member: { role: "member", displayName: "Member", email: "member@example.com", joinedAt: "2026-07-15T00:01:00.000Z" },
        },
      });
      await setDoc(doc(context.firestore(), `users/member/households/${HOUSEHOLD_ID}`), { householdId: HOUSEHOLD_ID, role: "member" });
    });
    const member = environment.authenticatedContext("member").firestore();
    const batch = writeBatch(member);
    batch.update(doc(member, META_PATH), {
      "membersByUid.member": deleteField(),
      updatedAt: "2026-07-15T00:03:00.000Z",
    });
    batch.delete(doc(member, `users/member/households/${HOUSEHOLD_ID}`));
    await assertSucceeds(batch.commit());
    await assertFails(getDoc(doc(member, META_PATH)));

    const owner = environment.authenticatedContext("owner").firestore();
    await assertFails(updateDoc(doc(owner, META_PATH), {
      "membersByUid.owner": deleteField(),
      updatedAt: "2026-07-15T00:04:00.000Z",
    }));
  });

  it("lets an owner revoke access and delete the target discovery link", async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const meta = householdMeta();
      await setDoc(doc(context.firestore(), META_PATH), {
        ...meta,
        membersByUid: {
          ...meta.membersByUid,
          member: { role: "member", displayName: "Member", email: "member@example.com", joinedAt: "2026-07-15T00:01:00.000Z" },
        },
      });
      await setDoc(doc(context.firestore(), `users/member/households/${HOUSEHOLD_ID}`), { householdId: HOUSEHOLD_ID, role: "member" });
    });
    const owner = environment.authenticatedContext("owner").firestore();
    const batch = writeBatch(owner);
    batch.update(doc(owner, META_PATH), {
      "membersByUid.member": deleteField(),
      inviteCode: `${HOUSEHOLD_ID}_rotated`,
      updatedAt: "2026-07-15T00:05:00.000Z",
    });
    batch.delete(doc(owner, `users/member/households/${HOUSEHOLD_ID}`));
    await assertSucceeds(batch.commit());

    const member = environment.authenticatedContext("member").firestore();
    await assertFails(getDoc(doc(member, META_PATH)));
    const deletedLink = await assertSucceeds(getDoc(doc(member, `users/member/households/${HOUSEHOLD_ID}`)));
    expect(deletedLink.exists()).toBe(false);
  });

  it("pins the snapshot manifest shape and stamps the writer as author", async () => {
    const owner = environment.authenticatedContext("owner").firestore();
    const manifestRef = doc(owner, `households/${HOUSEHOLD_ID}/snapshotManifest/current`);
    const wellFormed = {
      schemaVersion: 1,
      activeRevision: "rev_1",
      versionToken: "token_1",
      updatedAt: "2026-07-15T00:02:00.000Z",
      updatedBy: "owner",
    };

    await assertSucceeds(setDoc(manifestRef, wellFormed));
    // Forged author.
    await assertFails(setDoc(manifestRef, { ...wellFormed, updatedBy: "someone-else" }));
    // Wrong manifest version.
    await assertFails(setDoc(manifestRef, { ...wellFormed, schemaVersion: 2 }));
    // Empty compare-and-swap token.
    await assertFails(setDoc(manifestRef, { ...wellFormed, versionToken: "" }));
    // Unexpected extra field.
    await assertFails(setDoc(manifestRef, { ...wellFormed, injected: true }));
  });

  it("rejects poison-pill schema versions and oversized documents", async () => {
    const owner = environment.authenticatedContext("owner").firestore();

    // A future version would lock every current client out of the household.
    await assertFails(setDoc(doc(owner, `households/${HOUSEHOLD_ID}/settings/current`), { schemaVersion: 99 }));
    await assertFails(setDoc(doc(owner, `households/${HOUSEHOLD_ID}/snapshots/rev_1`), { schemaVersion: 99 }));
    // Within range stays allowed.
    await assertSucceeds(setDoc(doc(owner, `households/${HOUSEHOLD_ID}/settings/current`), { schemaVersion: 9 }));

    const stuffed = Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`k${index}`, index]));
    await assertFails(setDoc(doc(owner, `households/${HOUSEHOLD_ID}/snapshots/rev_1/transactions/txn_big`), stuffed));
  });

  it("still lets members delete documents a delta save removes", async () => {
    const owner = environment.authenticatedContext("owner").firestore();
    const txnRef = doc(owner, `households/${HOUSEHOLD_ID}/snapshots/rev_1/transactions/txn_1`);
    await assertSucceeds(setDoc(txnRef, { amount: 10 }));
    await assertSucceeds(deleteDoc(txnRef));
  });

  it("allows profile access only to the profile owner", async () => {
    const owner = environment.authenticatedContext("owner").firestore();
    const outsider = environment.authenticatedContext("outsider").firestore();
    const profile = doc(owner, "users/owner/profile/current");

    await assertSucceeds(setDoc(profile, { privacy: true }));
    await assertSucceeds(getDoc(profile));
    await assertFails(getDoc(doc(outsider, "users/owner/profile/current")));
  });
});
