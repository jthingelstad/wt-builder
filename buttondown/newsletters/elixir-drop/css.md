/* Elixir Drop — Buttondown newsletter theme.
 *
 * Paste into Buttondown → Settings → Design → CSS, or apply with
 * `npm run theme:buttondown` using a key that has newsletter scope.
 *
 * Selectors come from Buttondown's Modern template, which is what this
 * newsletter uses. The exposed hooks are:
 *   .newsletter-masthead   name + icon at the top
 *   .subject               the headline
 *   .description           the email description
 *   .colophon              "ELIXIR DROP · AUGUST 15, 2026"
 *   .email-preamble        the "did someone forward you this?" line
 *   .newsletter-body       the letter itself
 *   .newsletter-header / .newsletter-footer / .newsletter-colophon
 *
 * An earlier version of this file guessed at .email-body / .email-container /
 * #content. None of those exist, so the type colors applied and the dark
 * backgrounds did not — light lavender text on a white card. Every background
 * rule below names a selector Buttondown documents, and pairs the background
 * with the text color on the same element so a client that drops one tends to
 * drop both.
 *
 * Written for mail clients: literal colors (no custom properties), no flex or
 * grid, and a real fallback stack behind the webfont.
 */

/* Supercell's official Clash display font, the same file the app serves, under
 * the Fan Content Policy the rest of Drop's card art already relies on. Pages
 * sends access-control-allow-origin: *, so the web archive can load it too.
 * Apple Mail honours this; Gmail ignores webfonts and takes the fallback. */
@font-face {
  font-family: 'Clash Royale';
  src: url('https://drop.poapkings.com/assets/fonts/Clash_Regular.otf') format('opentype');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

html,
body {
  margin: 0;
  padding: 0;
  background-color: #0a0818 !important;
  color: #f0ecff !important;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 1.6;
}

.newsletter-masthead,
.newsletter-header,
.newsletter-colophon,
.newsletter-footer,
.email-preamble {
  background-color: #0a0818 !important;
  color: #9a90c4 !important;
}

.newsletter-body {
  max-width: 600px;
  margin: 0 auto;
  padding: 22px 20px 28px;
  background-color: #120d28 !important;
  color: #e6e0ff !important;
  border: 1px solid rgba(215, 200, 255, 0.12);
  border-radius: 18px;
}

.subject {
  color: #f5c84c !important;
  font-family: 'Clash Royale', -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif;
  font-size: 26px;
  line-height: 1.15;
}

.description,
.colophon {
  color: #9a90c4 !important;
  font-size: 13px;
  letter-spacing: 0.04em;
}

.newsletter-icon {
  width: 64px;
  height: 64px;
  border-radius: 16px;
}

h1,
h2,
h3 {
  margin: 26px 0 10px;
  color: #ffffff !important;
  font-family: 'Clash Royale', -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif;
  font-weight: 400;
  line-height: 1.2;
}

h1 {
  color: #f5c84c !important;
  font-size: 25px;
}

h2 {
  font-size: 20px;
}

h3 {
  font-size: 17px;
}

p,
li {
  color: #e6e0ff !important;
}

p {
  margin: 0 0 16px;
}

/* Each section of a release letter opens on a bold lead. Gold is the app's
   accent, so the lead reads as a heading without being one. */
.newsletter-body strong {
  color: #f5c84c !important;
  font-weight: 700;
}

.newsletter-body em {
  color: #d7c8ff !important;
  font-style: italic;
}

.newsletter-body a {
  color: #d7c8ff !important;
  text-decoration: underline;
  text-underline-offset: 2px;
}

ul,
ol {
  margin: 0 0 16px;
  padding-left: 22px;
}

li {
  margin-bottom: 7px;
}

blockquote {
  margin: 20px 0;
  padding: 12px 16px;
  border-left: 3px solid #f5c84c;
  border-radius: 0 12px 12px 0;
  background-color: #23164d !important;
  color: #f0ecff !important;
}

hr {
  height: 1px;
  margin: 26px 0;
  border: 0;
  background-color: rgba(215, 200, 255, 0.18);
}

code {
  padding: 1px 5px;
  border-radius: 5px;
  background-color: #23164d !important;
  color: #ffe99a !important;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 14px;
}

/* Badge medallions and mode emblems sit in a row of their own. Inline-block
   keeps them flowing and wrapping without any layout engine. */
img {
  max-width: 100%;
  height: auto;
  border: 0;
  vertical-align: middle;
}

.newsletter-body p img {
  display: inline-block;
  width: 56px;
  height: 56px;
  margin: 4px 6px 4px 0;
}

/* Never let the unsubscribe link disappear into the background. */
.newsletter-colophon a,
.newsletter-footer a {
  color: #b9a9ee !important;
}