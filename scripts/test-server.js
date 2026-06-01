// Throwaway listener used to validate project/branch detection.
const http = require('node:http');
const port = Number(process.argv[2] || 3000);
http.createServer((req, res) => { res.end('ok'); }).listen(port, () => {
  console.log('listening on', port);
});
