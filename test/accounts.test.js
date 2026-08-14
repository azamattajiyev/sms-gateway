const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { openDb, closeDb, getDb } = require("../db");
const accounts = require("../accounts");

describe("accounts", () => {
  before(() => {
    openDb(":memory:");
  });

  after(() => {
    closeDb();
  });

  it("create returns a raw apiKey once; DB stores hash and prefix only", () => {
    const created = accounts.create({
      name: "Acme",
      smsQuota: 3,
      otpLength: 4,
      brandName: "Acme Co"
    });

    assert.ok(created.id);
    assert.match(created.apiKey, /^otp_[0-9a-f]{64}$/);
    assert.equal(created.apiKeyPrefix, created.apiKey.slice(0, 8));
    assert.equal(created.smsQuota, 3);
    assert.equal(created.otpLength, 4);
    assert.equal(created.brandName, "Acme Co");
    assert.equal(created.enabled, true);
    assert.ok(created.createdAt);
    assert.ok(created.updatedAt);

    const listed = accounts.list();
    const fromList = listed.find((a) => a.id === created.id);
    assert.ok(fromList);
    assert.equal(fromList.apiKey, undefined);
    assert.equal(fromList.apiKeyPrefix, created.apiKeyPrefix);

    const row = getDb().prepare("SELECT * FROM accounts WHERE id = ?").get(created.id);
    assert.equal(row.api_key_prefix, created.apiKey.slice(0, 8));
    assert.equal(row.api_key_hash.length, 64);
    assert.notEqual(row.api_key_hash, created.apiKey);
    assert.equal(JSON.stringify(row).includes(created.apiKey), false);
  });

  it("findByApiKey returns the account for the raw key and null for a wrong key", () => {
    const created = accounts.create({
      name: "Lookup",
      smsQuota: 1,
      otpLength: 6,
      brandName: "Brand"
    });

    const found = accounts.findByApiKey(created.apiKey);
    assert.ok(found);
    assert.equal(found.id, created.id);
    assert.equal(found.name, "Lookup");
    assert.equal(found.otpLength, 6);
    assert.equal(found.enabled, true);
    assert.equal(found.apiKey, undefined);

    assert.equal(accounts.findByApiKey("otp_deadbeef"), null);
    assert.equal(accounts.findByApiKey(""), null);
    assert.equal(accounts.findByApiKey(null), null);
  });

  it("tryConsumeQuota decrements to 0 then returns false", () => {
    const created = accounts.create({
      name: "Quota",
      smsQuota: 2,
      otpLength: 4,
      brandName: "Q"
    });

    assert.equal(accounts.tryConsumeQuota(created.id), true);
    assert.equal(accounts.getById(created.id).smsQuota, 1);
    assert.equal(accounts.tryConsumeQuota(created.id), true);
    assert.equal(accounts.getById(created.id).smsQuota, 0);
    assert.equal(accounts.tryConsumeQuota(created.id), false);
    assert.equal(accounts.getById(created.id).smsQuota, 0);
  });

  it("addQuota increases remaining count", () => {
    const created = accounts.create({
      name: "Topup",
      smsQuota: 0,
      otpLength: 4,
      brandName: "T"
    });

    assert.equal(accounts.tryConsumeQuota(created.id), false);
    const topped = accounts.addQuota(created.id, 5);
    assert.equal(topped.smsQuota, 5);
    assert.equal(accounts.tryConsumeQuota(created.id), true);
    assert.equal(accounts.getById(created.id).smsQuota, 4);
  });

  it("update changes name, otpLength, brandName, enabled without changing quota", () => {
    const created = accounts.create({
      name: "Old",
      smsQuota: 9,
      otpLength: 4,
      brandName: "OldBrand"
    });

    const updated = accounts.update(created.id, {
      name: "New",
      otpLength: 8,
      brandName: "NewBrand",
      enabled: false
    });

    assert.equal(updated.name, "New");
    assert.equal(updated.otpLength, 8);
    assert.equal(updated.brandName, "NewBrand");
    assert.equal(updated.enabled, false);
    assert.equal(updated.smsQuota, 9);
    assert.equal(accounts.getById(99999), null);
    assert.equal(accounts.update(99999, { name: "Nope" }), null);
  });

  it("regenerateApiKey rotates hash; old key stops working", () => {
    const created = accounts.create({
      name: "Rotate",
      smsQuota: 1,
      otpLength: 4,
      brandName: "R"
    });
    const oldKey = created.apiKey;

    const rotated = accounts.regenerateApiKey(created.id);
    assert.match(rotated.apiKey, /^otp_[0-9a-f]{64}$/);
    assert.notEqual(rotated.apiKey, oldKey);
    assert.equal(rotated.apiKeyPrefix, rotated.apiKey.slice(0, 8));

    assert.equal(accounts.findByApiKey(oldKey), null);
    const found = accounts.findByApiKey(rotated.apiKey);
    assert.ok(found);
    assert.equal(found.id, created.id);
    assert.equal(found.apiKey, undefined);
  });

  it("disabled account is still findable; consume fails", () => {
    const created = accounts.create({
      name: "Off",
      smsQuota: 10,
      otpLength: 4,
      brandName: "OffBrand"
    });

    const disabled = accounts.remove(created.id);
    assert.equal(disabled.enabled, false);

    const found = accounts.findByApiKey(created.apiKey);
    assert.ok(found);
    assert.equal(found.enabled, false);
    assert.equal(found.id, created.id);

    assert.equal(accounts.tryConsumeQuota(created.id), false);
    assert.equal(accounts.getById(created.id).smsQuota, 10);
  });

  it("rejects invalid create fields", () => {
    assert.throws(() => accounts.create({ name: "  ", brandName: "B" }), /name/);
    assert.throws(() => accounts.create({ name: "N", brandName: "" }), /brandName/);
    assert.throws(
      () => accounts.create({ name: "N", brandName: "B", otpLength: 3 }),
      /otpLength/
    );
    assert.throws(
      () => accounts.create({ name: "N", brandName: "B", otpLength: 9 }),
      /otpLength/
    );
    assert.throws(
      () => accounts.create({ name: "N", brandName: "B", smsQuota: -1 }),
      /smsQuota/
    );
    assert.throws(() => accounts.addQuota(1, 0), /amount/);
  });
});
