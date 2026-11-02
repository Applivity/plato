/**
 * stdout is the protocol channel. Redirect the console's stdout writers to
 * stderr so a stray log line from the product can never corrupt a message.
 */
const toStderr = (...args: unknown[]): void => {
  console.error(...args);
};

console.log = toStderr;
console.info = toStderr;
console.debug = toStderr;
