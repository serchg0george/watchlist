const directives = {
  "default-src": ["'self'"],
  "script-src": ["'self'"],
  "style-src": ["'self'"],
  "img-src": ["'self'", "https://image.tmdb.org", "data:"],
  "connect-src": ["'self'", "https://api.github.com", "https://api.themoviedb.org"],
  "font-src": ["'self'"],
  "manifest-src": ["'self'"],
  "worker-src": ["'self'"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"]
};

export const CSP = Object.entries(directives)
  .map(([name, sources]) => [name, ...sources].join(" "))
  .join("; ");

export function injectCsp(html: string): string {
  const charset = /<meta\s+charset\s*=\s*[^>]+>/i;
  if (!charset.test(html)) throw new Error("Missing charset meta tag for the content security policy");
  return html.replace(charset, (tag) =>
    `${tag}\n  <meta http-equiv="Content-Security-Policy" content="${CSP}">`);
}
