function apiOk(res, data, status = 200) {
  res.status(status).json({ ok: true, data, error: null });
}

function apiError(res, status, error, data = null) {
  res.status(status).json({ ok: false, data, error });
}

module.exports = {
  apiOk,
  apiError,
};
