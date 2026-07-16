import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
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

  it("allows profile access only to the profile owner", async () => {
    const owner = environment.authenticatedContext("owner").firestore();
    const outsider = environment.authenticatedContext("outsider").firestore();
    const profile = doc(owner, "users/owner/profile/current");

    await assertSucceeds(setDoc(profile, { privacy: true }));
    await assertSucceeds(getDoc(profile));
    await assertFails(getDoc(doc(outsider, "users/owner/profile/current")));
  });
});
