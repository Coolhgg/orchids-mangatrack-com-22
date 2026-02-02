const dns = require('node:dns');
const { initDNS } = require('@/lib/dns-init');

initDNS();

console.log('Current servers:', dns.getServers());

dns.lookup('api.mangadex.org', (err, address, family) => {
  if (err) {
    console.error('Lookup failed:', err);
  } else {
    console.log('Lookup success:', address);
  }
});

dns.resolve4('api.mangadex.org', (err, addresses) => {
  if (err) {
    console.error('Resolve failed:', err);
  } else {
    console.log('Resolve success:', addresses);
  }
});
