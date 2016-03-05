var Queue = require('./lib/queue')
var q = new Queue(function (task, cb) {
  console.log('working' + task);
  setTimeout(function () {
    console.log('finished' + task);
    cb(null, { message: 'done' + task });
  }, task*1000);
}, { concurrent: 1, idleTimeout: 1000 })
console.log('queued 1')
q.push(1);
console.log('queued 2')
q.push(2);
console.log('queued 3')
q.push(3);
console.log('queued 4')
q.push(4);

