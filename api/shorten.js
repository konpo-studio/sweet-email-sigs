export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'No URL provided' });

  try {
    const r = await fetch(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`);
    const short = await r.text();
    if (short && short.startsWith('https://is.gd/')) {
      res.setHeader('Cache-Control', 's-maxage=86400');
      return res.json({ short });
    }
    return res.status(500).json({ error: 'Unexpected response', raw: short });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
