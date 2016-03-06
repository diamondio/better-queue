var Queue = require('./lib/queue')
// var q = new Queue(function (task, cb) {
//   console.log('working' + task);
//   setTimeout(function () {
//     console.log('finished' + task);
//     cb(null, { message: 'done' + task });
//   }, task*1000);
// }, { concurrent: 2, idleTimeout: 1000 })
// console.log('queued 1')
// q.push(1);
// console.log('queued 2')
// q.push(2);
// console.log('queued 3')
// q.push(3);
// console.log('queued 4')
// q.push(4);


// var greeter = new Queue(function (name, cb) {
//   console.log("Hello, %s!", name)
//   cb();
// }, {
//   filter: function (input, cb) {
//     if (input === 'Bob') {
//       return cb('not_allowed');
//     }
//     return cb(null, input.toUpperCase())
//   }
// });
// greeter.push('anna'); // Prints 'Hello, ANNA!'


// var counter = new Queue(function (task, cb) {
//   console.log("I have %d %ss.", task.count, task.id);
//   cb();
// }, {
//   merge: function (oldTask, newTask, cb) {
//     oldTask.count += newTask.count;
//     cb(null, oldTask);
//   }
// })
// counter.push({ id: 'apple', count: 2 });
// counter.push({ id: 'apple', count: 1 });
// counter.push({ id: 'orange', count: 1 });
// counter.push({ id: 'orange', count: 1 });

// var greeter = new Queue(function (name, cb) {
//   console.log("Greetings, %s.", name);
//   cb();
// }, {
//   priority: function (name, cb) {
//     if (name === "Steve") return cb(null, 10);
//     if (name === "Mary") return cb(null, 5);
//     if (name === "Joe") return cb(null, 5);
//     cb(null, 1);
//   }
// })
// greeter.push("Steve");
// greeter.push("John");
// greeter.push("Joe");
// greeter.push("Mary");


// var q = new Queue(function (batch, cb) {
//   console.log(Object.keys(batch).length)
//   cb();
// }, { batchSize: 10, processDelay: 2000 })
// q.push(1);
// q.push(2);
// setTimeout(function () {
//   q.push(3);
//   q.push(4);
//   q.push(5);
// }, 1000)

// var q = new Queue(function (task, cb) {
//   console.log("Finished %s.", task)
//   cb();
// }, { idleTimeout: 1000 })
// q.push("task1");
// q.push("task2");

var ages = new Queue(function (batch, cb) {
  // Batch:
  //  {
  //    
  //  }
  console.log(batch);
  cb();
}, { batchSize: 3 })
ages.push(1);
ages.push(2);
ages.push(3);

