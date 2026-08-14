const express = require("express");
const accounts = require("../accounts");

const router = express.Router();

function redirectAfterSession(req, res, location) {
  req.session.save((err) => {
    if (err) {
      console.error("Failed to save admin session");
    }
    res.redirect(location);
  });
}

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

function validationMessage(err) {
  const msg = err && err.message;
  if (typeof msg === "string" && /must be/.test(msg)) {
    return msg;
  }
  return "Unable to save account";
}

function parseAccountId(param) {
  const id = Number(param);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

function parseNumberOrDefault(value, defaultValue) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return defaultValue;
  }
  return Number(value);
}

function isChecked(value) {
  return value === "on" || value === "1" || value === "true" || value === true;
}

function createValuesFromBody(body) {
  const src = body || {};
  return {
    name: typeof src.name === "string" ? src.name : "",
    brandName: typeof src.brandName === "string" ? src.brandName : "",
    otpLength: src.otpLength === undefined || src.otpLength === null ? "4" : String(src.otpLength),
    smsQuota: src.smsQuota === undefined || src.smsQuota === null ? "0" : String(src.smsQuota)
  };
}

function editValuesFromAccount(account, body) {
  const src = body || {};
  return {
    name: typeof src.name === "string" ? src.name : account.name,
    brandName: typeof src.brandName === "string" ? src.brandName : account.brandName,
    otpLength:
      src.otpLength === undefined || src.otpLength === null
        ? account.otpLength
        : src.otpLength,
    enabled: body ? isChecked(src.enabled) : account.enabled
  };
}

function loadAccountOrRedirect(req, res, idParam) {
  const id = parseAccountId(idParam);
  if (id == null) {
    setFlash(req, "error", "Account not found");
    redirectAfterSession(req, res, "/admin/accounts");
    return null;
  }
  const account = accounts.getById(id);
  if (!account) {
    setFlash(req, "error", "Account not found");
    redirectAfterSession(req, res, "/admin/accounts");
    return null;
  }
  return account;
}

function storeOneTimeApiKey(req, accountId, apiKey) {
  req.session.justCreatedApiKey = { accountId, apiKey };
}

function renderCreate(res, { error, values }) {
  if (error) {
    res.locals.flash = { type: "error", message: error };
  }
  res.render("pages/admin/accounts/create", {
    title: "Create account",
    values: values || createValuesFromBody({})
  });
}

function renderEdit(res, { account, error, values }) {
  if (error) {
    res.locals.flash = { type: "error", message: error };
  }
  res.render("pages/admin/accounts/edit", {
    title: "Edit account",
    account,
    values: values || editValuesFromAccount(account)
  });
}

router.get("/", (req, res) => {
  res.render("pages/admin/accounts/index", {
    title: "Accounts",
    accounts: accounts.list()
  });
});

router.get("/new", (req, res) => {
  renderCreate(res, { values: createValuesFromBody({}) });
});

router.post("/", (req, res) => {
  const values = createValuesFromBody(req.body);
  try {
    const created = accounts.create({
      name: values.name,
      brandName: values.brandName,
      otpLength: parseNumberOrDefault(values.otpLength, 4),
      smsQuota: parseNumberOrDefault(values.smsQuota, 0)
    });
    storeOneTimeApiKey(req, created.id, created.apiKey);
    setFlash(req, "success", "Account created");
    return redirectAfterSession(req, res, `/admin/accounts/${created.id}/created`);
  } catch (err) {
    return renderCreate(res, { error: validationMessage(err), values });
  }
});

router.get("/:id/created", (req, res) => {
  const account = loadAccountOrRedirect(req, res, req.params.id);
  if (!account) return;

  const pending = req.session.justCreatedApiKey;
  const matches =
    pending &&
    pending.accountId === account.id &&
    typeof pending.apiKey === "string" &&
    pending.apiKey;

  delete req.session.justCreatedApiKey;

  if (!matches) {
    setFlash(req, "error", "API key is no longer available. Generate a new key if needed.");
    return redirectAfterSession(req, res, `/admin/accounts/${account.id}/edit`);
  }

  req.session.save((err) => {
    if (err) {
      console.error("Failed to save admin session");
    }
    res.render("pages/admin/accounts/created", {
      title: "API key",
      account,
      apiKey: pending.apiKey
    });
  });
});

router.get("/:id/edit", (req, res) => {
  const account = loadAccountOrRedirect(req, res, req.params.id);
  if (!account) return;
  renderEdit(res, { account });
});

router.post("/:id", (req, res) => {
  const account = loadAccountOrRedirect(req, res, req.params.id);
  if (!account) return;

  const values = editValuesFromAccount(account, req.body);
  try {
    const updated = accounts.update(account.id, {
      name: values.name,
      brandName: values.brandName,
      otpLength: parseNumberOrDefault(values.otpLength, account.otpLength),
      enabled: values.enabled
    });
    if (!updated) {
      setFlash(req, "error", "Account not found");
      return redirectAfterSession(req, res, "/admin/accounts");
    }
    setFlash(req, "success", "Account updated");
    return redirectAfterSession(req, res, `/admin/accounts/${account.id}/edit`);
  } catch (err) {
    return renderEdit(res, {
      account,
      error: validationMessage(err),
      values
    });
  }
});

router.post("/:id/topup", (req, res) => {
  const account = loadAccountOrRedirect(req, res, req.params.id);
  if (!account) return;

  try {
    const amount = parseNumberOrDefault(req.body && req.body.amount, NaN);
    const updated = accounts.addQuota(account.id, amount);
    if (!updated) {
      setFlash(req, "error", "Account not found");
      return redirectAfterSession(req, res, "/admin/accounts");
    }
    setFlash(req, "success", `Added ${amount} SMS`);
    return redirectAfterSession(req, res, `/admin/accounts/${account.id}/edit`);
  } catch (err) {
    return renderEdit(res, {
      account,
      error: validationMessage(err),
      values: editValuesFromAccount(account)
    });
  }
});

router.post("/:id/regenerate-key", (req, res) => {
  const account = loadAccountOrRedirect(req, res, req.params.id);
  if (!account) return;

  const updated = accounts.regenerateApiKey(account.id);
  if (!updated || !updated.apiKey) {
    setFlash(req, "error", "Account not found");
    return redirectAfterSession(req, res, "/admin/accounts");
  }

  storeOneTimeApiKey(req, updated.id, updated.apiKey);
  setFlash(req, "success", "API key regenerated");
  return redirectAfterSession(req, res, `/admin/accounts/${updated.id}/created`);
});

router.post("/:id/disable", (req, res) => {
  const account = loadAccountOrRedirect(req, res, req.params.id);
  if (!account) return;

  const updated = accounts.remove(account.id);
  if (!updated) {
    setFlash(req, "error", "Account not found");
    return redirectAfterSession(req, res, "/admin/accounts");
  }
  setFlash(req, "success", "Account disabled");
  return redirectAfterSession(req, res, `/admin/accounts/${account.id}/edit`);
});

module.exports = router;
