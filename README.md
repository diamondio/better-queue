# Better Queue - Powerful flow control

[![npm package](https://nodei.co/npm/better-queue.png?downloads=true&downloadRank=true&stars=true)](https://nodei.co/npm/better-queue/)

[![Build status](https://img.shields.io/travis/leanderlee/better-queue.svg?style=flat-square)](https://travis-ci.org/leanderlee/better-queue)
[![Dependency Status](https://img.shields.io/david/leanderlee/better-queue.svg?style=flat-square)](https://david-dm.org/leanderlee/better-queue)
[![Known Vulnerabilities](https://snyk.io/test/npm/better-queue/badge.svg?style=flat-square)](https://snyk.io/test/npm/better-queue)
[![Gitter](https://img.shields.io/badge/gitter-join_chat-blue.svg?style=flat-square)](https://gitter.im/leanderlee/better-queue?utm_source=badge)


## Super simple to use

Better Queue is designed to be simple to set up but still let you do complex things.

```js
var Queue = require('better-queue');
var q = new Queue(function (n, cb) {
  cb(null, n+1);
})
q.push(1)
q.push(2)
q.push(3)
```

## Table of contents

- [Setting Up](#setting-up-the-queue)
- [Queuing](#queuing)
- [Task Management](#task-management)
- [Timing](#timing)
- [More Queuing](#timing)
- [Storage](#storage)
- [Full Documentation](#full-documentation)

---

You will be able to combine any (and all) of these options
for your queue!


## Setting up the queue

You can control how many tasks happen at the same time.

```js
var q = new Queue(fn, { concurrent: 3 })
```

Now the queue will allow 3 tasks running at the same time. (By 
default, we handle tasks one at a time.)

You can also turn the queue into a stack by turning on `filo`.

```js
var q = new Queue(fn, { filo: true })
```

Now items you push on will be handled first.


## Queuing

It's very easy to push tasks into the queue.

```js
var q = new Queue(fn);
q.push(1);
q.push({ x: 1, y: 2 });
q.push("hello");
```

You can also include a callback as a second parameter to the push
function, which would be called when that task is done. For example:

```js
var q = new Queue(fn);
q.push(1, function (err, result) {
  // Results from the task!
});
```

You can also listen to events on the results of the `push` call.

```js
var q = new Queue(fn);
q.push(1)
  .on('done', function (result) {
    // Task succeeded with {result}!
  })
  .on('fail', function (err) {
    // Task failed!
  })
```

Alternatively, you can subscribe to the queue's events.

```js
var q = new Queue(fn);
q.on('task_finish', function (taskId, result) {
  // taskId = 1, result: 3
  // taskId = 2, result: 5
})
q.on('task_failed', function (taskId, err) {
  // Handle error
})
q.on('empty', function (){})
q.on('drain', function (){})
q.push({ id: 1, a: 1, b: 2 });
q.push({ id: 2, a: 2, b: 3 });
```

`empty` event fires when all of the tasks have been pulled off of
the queue (there may still be tasks running!)

`drain` event fires when there are no more tasks on the queue _and_
when no more tasks are running.


[back to top](#table-of-contents)

---

## Task Management

#### Batch Processing

Tasks can be identified by `task.id`. If it isn't defined,
a unique ID is automatically assigned. One thing you can do 
with Task ID is merge tasks with the same ID.

```js
var counter = new Queue(function (task, cb) {
  console.log("I have %d %ss.", task.count, task.id);
  cb();
}, {
  merge: function (oldTask, newTask, cb) {
    oldTask.count += newTask.count;
    cb(null, oldTask);
  }
})
counter.push({ id: 'apple', count: 2 });
counter.push({ id: 'apple', count: 1 });
counter.push({ id: 'orange', count: 1 });
counter.push({ id: 'orange', count: 1 });
// Prints out:
//   I have 3 apples.
//   I have 2 oranges.
```

Your processing function can also be modified to handle multiple
tasks at the same time. For example:

```js
var ages = new Queue(function (batch, cb) {
  // Batch 1:
  //   [ { id: 'steve', age: 21 },
  //     { id: 'john', age: 34 },
  //     { id: 'joe', age: 18 } ]
  // Batch 2:
  //   [ { id: 'mary', age: 23 } ]
  cb();
}, { batchSize: 3 })
ages.push({ id: 'steve', age: 21 });
ages.push({ id: 'john', age: 34 });
ages.push({ id: 'joe', age: 18 });
ages.push({ id: 'mary', age: 23 });
```

Note how the queue will only handle at most 3 items at a time.

If the task has no ID, you can still batch the tasks, but they will
be assigned a uuid.

```js
var ages = new Queue(function (batch, cb) {
  // batch = [1,2,3]
  cb();
}, { batchSize: 3 })
ages.push(1);
ages.push(2);
ages.push(3);
```


#### Filtering, Validation and Priority

You can also format (and filter) the input that arrives from a push
before it gets processed by the queue by passing in a `filter` 
function.

```js
var greeter = new Queue(function (name, cb) {
  console.log("Hello, %s!", name)
  cb();
}, {
  filter: function (input, cb) {
    if (input === 'Bob') {
      return cb('not_allowed');
    }
    return cb(null, input.toUpperCase())
  }
});
greeter.push('anna'); // Prints 'Hello, ANNA!'
```

This can be particularly useful if your queue needs to do some pre-processing,
input validation, database lookup, etc. before you load it onto the queue.

You can also define a priority function to control what tasks get
processed first.

```js
var greeter = new Queue(function (name, cb) {
  console.log("Greetings, %s.", name);
  cb();
}, {
  priority: function (name, cb) {
    if (name === "Steve") return cb(null, 10);
    if (name === "Mary") return cb(null, 5);
    if (name === "Joe") return cb(null, 5);
    cb(null, 1);
  }
})
greeter.push("Steve");
greeter.push("John");
greeter.push("Joe");
greeter.push("Mary");

// Prints out:
//   Greetings, Steve.
//   Greetings, Joe.
//   Greetings, Mary.
//   Greetings, John.
```

If `filo` is set to `true` in the example above, then Joe and Mary 
would swap order.


[back to top](#table-of-contents)

---

## Timing

You can configure the queue to have a maxTimeout.

```js
var q = new Queue(function (name, cb) {
  someLongTask(function () {
    cb();
  })
}, { maxTimeout: 2000 })
```

After 2 seconds, the process will throw an error instead of wait for the
callback to finish.

You can also configure the queue to wait before it starts initially 
processing. This is the behaviour of a timed cargo.

```js
var q = new Queue(function (batch, cb) {
  // Batch of 5 will process after 2s.
  cb();
}, { batchSize: 10, processDelay: 2000 })
q.push(1);
q.push(2);
setTimeout(function () {
  q.push(3);
  q.push(4);
  q.push(5);
}, 1000)
```

In the example above, the queue starts processing 2 seconds after the first
task has been pushed on the queue.

You can also set an `idleTimeout`, which will give the CPU some time to breathe
between processing tasks.

```js
var q = new Queue(function (task, cb) {
  console.log("Finished %s.", task)
  cb();
}, { idleTimeout: 1000 })
q.push("task1");
q.push("task2");
```

task1 will print, wait 1 second before printing task2.


[back to top](#table-of-contents)

---

## Even more things

  .on('progress', function (err, progress) {
    // progress.eta - human readable string estimating time remaining
    // progress.pct - % complete (out of 100)
    // progress.current - # completed so far
    // progress.total - # for completion
  })
- cancel, pause, resume
- maxRetries
- drain and empty


[back to top](#table-of-contents)

---

## Storage

- store

[back to top](#table-of-contents)

---

## Full Documentation

