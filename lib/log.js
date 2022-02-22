const { hitTeamsTrigger } = require("./teams-trigger");
const moment = require("moment");

const log = async (message) => {
  const currentTime = moment().format("MMMM Do YYYY, h:mm:ss a");
  console.log(`${currentTime} - ${message}`);
  message = `NODE_SERVICE
  </br> 
  ${message}
  </br>
  ${currentTime}`;
  await hitTeamsTrigger(message);
};

module.exports = { log };
