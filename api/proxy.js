// Vercel Serverless Function — CORS proxy for Denizli municipality API
export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  // Strip /api/denizli prefix to get the real path
  const targetPath = url.pathname.replace(/^\/api\/denizli/, '');
  const targetUrl = `https://ulasim.denizli.bel.tr${targetPath}${url.search}`;

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Upstream API error: ${response.status}` });
    }

    const data = await response.json();

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');

    return res.status(200).json(data);
  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({ error: 'Proxy request failed' });
  }
}
