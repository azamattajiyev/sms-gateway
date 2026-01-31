const queue = [];

function addToQueue(data) {
  queue.push(data);
}

function getNext() {
  return queue.shift();
}

function hasItems() {
  return queue.length > 0;
}

module.exports = {
  addToQueue,
  getNext,
  hasItems
};