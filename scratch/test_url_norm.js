const getNormalizedUrl = (url) => {
  if (!url) return '';
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
};

const testCases = [
  { url: 'http://example.com', expected: 'example.com' },
  { url: 'https://example.com', expected: 'example.com' },
  { url: 'http://example.com/', expected: 'example.com' },
  { url: 'https://example.com/', expected: 'example.com' },
];

console.log('--- Testing getNormalizedUrl ---');
testCases.forEach(({ url, expected }) => {
  const result = getNormalizedUrl(url);
  console.log(`${url} -> ${result} : ${result === expected ? 'PASS' : 'FAIL'}`);
});

const items = [
  { name: 'Example HTTP', url: 'http://example.com' },
  { name: 'Example HTTPS Long Name', url: 'https://example.com/' },
  { name: 'Google', url: 'https://google.com' }
];

console.log('\n--- Testing Deduplication Logic (Prefer HTTPS) ---');
const uniqueUrls = new Map();
items.forEach(item => {
  const normUrl = getNormalizedUrl(item.url);
  if (!uniqueUrls.has(normUrl)) {
    uniqueUrls.set(normUrl, item);
  } else {
    const existing = uniqueUrls.get(normUrl);
    const isNewHttps = item.url.startsWith('https://');
    const isExistingHttps = (existing.url || '').startsWith('https://');

    if (isNewHttps && !isExistingHttps) {
      uniqueUrls.set(normUrl, item);
    } else if (isNewHttps === isExistingHttps) {
      if ((item.name || '').length > (existing.name || '').length) {
        uniqueUrls.set(normUrl, item);
      }
    }
  }
});

console.log('Resulting Items:');
uniqueUrls.forEach((item, key) => {
  console.log(`${key}: ${item.url} (${item.name})`);
});

const googleExists = Array.from(uniqueUrls.values()).some(i => i.url === 'https://google.com');
const exampleHttpsExists = Array.from(uniqueUrls.values()).some(i => i.url === 'https://example.com/');
const exampleHttpDoesNotExist = !Array.from(uniqueUrls.values()).some(i => i.url === 'http://example.com');

console.log(`\nGoogle exists: ${googleExists}`);
console.log(`Example HTTPS exists: ${exampleHttpsExists}`);
console.log(`Example HTTP does not exist: ${exampleHttpDoesNotExist}`);

if (googleExists && exampleHttpsExists && exampleHttpDoesNotExist) {
  console.log('\nDeduplication Test: PASS');
} else {
  console.log('\nDeduplication Test: FAIL');
}
