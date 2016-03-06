# Better Queue - Powerful flow control

[![Join the chat at https://gitter.im/leanderlee/better-queue](https://badges.gitter.im/leanderlee/better-queue.svg)](https://gitter.im/leanderlee/better-queue?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)

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
q.push(1, function (err, result) {
  console.log(result);
})
```

