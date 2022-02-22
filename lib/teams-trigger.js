const axios = require("axios");

const hitTeamsTrigger = (message) => {
  const { TEAMS_TRIGGER_URL, ENVIRONMENT: environment } = process.env;
  return axios.post(TEAMS_TRIGGER_URL, { message, environment });
};

module.exports = { hitTeamsTrigger };
