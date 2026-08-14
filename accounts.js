const crypto = require("crypto");
const { getDb } = require("./db");

const NAME_MAX = 64;

function generateApiKey() {
  const raw = "otp_" + crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(raw, "utf8").digest("hex");
  return { raw, hash, prefix: raw.slice(0, 8) };
}

function hashApiKey(raw) {
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

function nowIso() {
  return new Date().toISOString();
}

function requireNonEmptyString(value, field, max = NAME_MAX) {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a non-empty string`);
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) {
    throw new Error(`${field} must be 1–${max} characters`);
  }
  return trimmed;
}

function requireOtpLength(value) {
  if (!Number.isInteger(value) || value < 4 || value > 8) {
    throw new Error("otpLength must be an integer between 4 and 8");
  }
  return value;
}

function requireNonNegativeInt(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value;
}

function requirePositiveInt(value, field) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}

function toPublic(row, extra = {}) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    apiKeyPrefix: row.api_key_prefix,
    smsQuota: row.sms_quota,
    otpLength: row.otp_length,
    brandName: row.brand_name,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extra
  };
}

function getRowById(id) {
  return getDb().prepare("SELECT * FROM accounts WHERE id = ?").get(id);
}

function create({ name, smsQuota = 0, otpLength = 4, brandName } = {}) {
  const trimmedName = requireNonEmptyString(name, "name");
  const trimmedBrand = requireNonEmptyString(brandName, "brandName");
  const quota = requireNonNegativeInt(smsQuota, "smsQuota");
  const length = requireOtpLength(otpLength);
  const { raw, hash, prefix } = generateApiKey();
  const ts = nowIso();

  const result = getDb()
    .prepare(
      `INSERT INTO accounts
        (name, api_key_hash, api_key_prefix, sms_quota, otp_length, brand_name, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .run(trimmedName, hash, prefix, quota, length, trimmedBrand, ts, ts);

  return toPublic(getRowById(result.lastInsertRowid), { apiKey: raw });
}

function list() {
  return getDb()
    .prepare("SELECT * FROM accounts ORDER BY id ASC")
    .all()
    .map((row) => toPublic(row));
}

function getById(id) {
  return toPublic(getRowById(id));
}

function findByApiKey(rawKey) {
  if (typeof rawKey !== "string" || !rawKey) return null;
  const row = getDb()
    .prepare("SELECT * FROM accounts WHERE api_key_hash = ?")
    .get(hashApiKey(rawKey));
  return toPublic(row);
}

function update(id, { name, otpLength, brandName, enabled } = {}) {
  const existing = getById(id);
  if (!existing) return null;

  const nextName =
    name !== undefined ? requireNonEmptyString(name, "name") : existing.name;
  const nextOtpLength =
    otpLength !== undefined ? requireOtpLength(otpLength) : existing.otpLength;
  const nextBrand =
    brandName !== undefined
      ? requireNonEmptyString(brandName, "brandName")
      : existing.brandName;
  const nextEnabled =
    enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled ? 1 : 0;

  getDb()
    .prepare(
      `UPDATE accounts
       SET name = ?, otp_length = ?, brand_name = ?, enabled = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(nextName, nextOtpLength, nextBrand, nextEnabled, nowIso(), id);

  return getById(id);
}

function addQuota(id, amount) {
  requirePositiveInt(amount, "amount");
  const result = getDb()
    .prepare(
      "UPDATE accounts SET sms_quota = sms_quota + ?, updated_at = ? WHERE id = ?"
    )
    .run(amount, nowIso(), id);
  if (result.changes !== 1) return null;
  return getById(id);
}

function tryConsumeQuota(id) {
  const result = getDb()
    .prepare(
      `UPDATE accounts
       SET sms_quota = sms_quota - 1, updated_at = ?
       WHERE id = ? AND enabled = 1 AND sms_quota > 0`
    )
    .run(nowIso(), id);
  return result.changes === 1;
}

function regenerateApiKey(id) {
  if (!getById(id)) return null;
  const { raw, hash, prefix } = generateApiKey();
  getDb()
    .prepare(
      `UPDATE accounts
       SET api_key_hash = ?, api_key_prefix = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(hash, prefix, nowIso(), id);
  return toPublic(getRowById(id), { apiKey: raw });
}

/** Soft-disable: sets enabled = 0. Rows are not deleted. */
function remove(id) {
  return update(id, { enabled: false });
}

module.exports = {
  create,
  list,
  getById,
  findByApiKey,
  update,
  addQuota,
  tryConsumeQuota,
  regenerateApiKey,
  remove
};
