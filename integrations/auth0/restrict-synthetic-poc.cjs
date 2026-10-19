// Install only in a dedicated PoC tenant's Post Login flow after explicit approval.
// No token issuance, custom claims, network requests or logging here.
exports.onExecutePostLogin = async (event, api) => {
  const { ALLOWED_CLIENT_ID, ALLOWED_SUBJECT, EXPECTED_RESOURCE } =
    event.secrets ?? {};
  const query = event.request?.query ?? {};
  if (
    !ALLOWED_CLIENT_ID ||
    !ALLOWED_SUBJECT ||
    !EXPECTED_RESOURCE ||
    event.client?.client_id !== ALLOWED_CLIENT_ID ||
    event.user?.user_id !== ALLOWED_SUBJECT ||
    event.user?.email_verified !== true ||
    event.resource_server?.identifier !== EXPECTED_RESOURCE ||
    query.resource !== EXPECTED_RESOURCE ||
    query.response_type !== "code" ||
    query.code_challenge_method !== "S256" ||
    typeof query.code_challenge !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(query.code_challenge)
  )
    api.access.deny("Synthetic test authorization denied");
};
