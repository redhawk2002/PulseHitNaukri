const randomDelay = async (min = 1000, max = 3000) => {
  const ms = Math.floor(Math.random() * (max - min + 1) + min);
  await new Promise(resolve => setTimeout(resolve, ms));
};

module.exports = {
  randomDelay
};
