# Website Design & Implementation

**Live URL (dev):** `http://mandrain-website-dev.s3-website-us-east-1.amazonaws.com/`  
**Production:** `https://gecktool.com/`  
**Hosting:** AWS S3 static website hosting  
**Deploy:** GitHub Actions (`deploy-website.yml`) — auto on `dev` push to `web_site/**`; manual `workflow_dispatch` for prod  

---

## Site Structure

```
web_site/
├── index.html                          # Gecktool brand homepage
└── Chinese-Slang-Translator/
    ├── index.html                      # Product page
    └── legal.html                      # Privacy Policy / T&C / Refund Policy
```

---

## Page 1 — Brand Homepage (`/`)

**Purpose:** Gecktool parent brand landing page. Entry point for all products.

### Sections

| Section | Content |
|---------|---------|
| **Nav** | Sticky, blur backdrop. Logo + Products / About / Contact links |
| **Hero** | "Small tools. Sharp focus." tagline. One-liner brand description. |
| **Products** | Flex-centered grid. Two cards: Chinese Slang Translator (live) + "More coming" placeholder |
| **About** | "One developer. Real tools." — no-bloat, no VC, independence pitch |
| **Footer** | Dark bg. Logo + product links + contact email + copyright |

### Design Tokens

| Token | Value |
|-------|-------|
| Font | Inter (Google Fonts) — weights 400/500/600/700/800 |
| Primary blue | `#1a56db` |
| Text | `#1a1a2e` |
| Muted text | `#6c757d` |
| Border | `#dee2e6` |
| Background alt | `#f8f9fa` |
| Border radius | 6px (default) / 12px (lg) / 20px (xl) |
| Shadows | 2-layer subtle shadow system |
| Nav height | 60px, sticky, `backdrop-filter: blur(12px)` |

### SEO / Meta
- `canonical`: `https://gecktool.com/`
- Open Graph: title, description, url, site_name, type
- `meta description`: brand pitch

---

## Page 2 — Product Page (`/Chinese-Slang-Translator/`)

**Purpose:** Full product landing page for the Chrome extension.

### Sections (top to bottom)

| Section | Key Content |
|---------|-------------|
| **Nav** | Breadcrumb: `Gecktool / Chinese Slang Translator`. Links: Features / Pricing / Privacy / FAQ / Add to Chrome CTA |
| **Hero** | H1: "Understand Chinese beyond literal translation". Extension mockup UI (browser + floating card). Two CTAs: Add to Chrome + View Features |
| **Comparison** | Side-by-side: Standard Translation vs Chinese Slang Translator. Three example Chinese internet terms with contrasting output style |
| **Features** | 4 feature cards: Natural meaning, Culturally aware, Instant contextual, Works everywhere |
| **Use Cases** | 4 scenario cards: Social media, Memes/humor, Entertainment, Professional |
| **Video Demo** | Placeholder iframe for demo video embed |
| **Pricing** | Two plans: Free (local dict, no account) vs Pro ($4.99/mo, AI + 2000+ slang + 3 devices) |
| **Trust** | 3 trust cards: Data minimalism, Active maintenance, Independent builder |
| **FAQ** | 6 questions with accordion toggle |
| **CTA Banner** | Full-width "Add to Chrome — Free" final CTA |
| **Footer** | Dark. 3 columns: brand, product links, legal & support. Copyright. |

### Product Card (brand homepage)
- Icon: 🧠
- Name: "Chinese **Slang Translator**" (span = blue)
- Type badge: Chrome Extension
- 4 feature bullets: Natural English translation / 2,000+ curated entries / AI-powered contextual analysis / Works on any website
- CTA: "View it →" → `./Chinese-Slang-Translator/`
- Sub-note: "Free to start · No account required"

### Design System (shared with homepage)
Same Inter font, same CSS variable tokens. Additional components:
- Extension mockup UI (browser chrome frame + floating card simulation)
- Comparison table (`cmp-card` left/right layout)
- Feature cards with icon + heading + description
- Pricing cards with feature checklist
- FAQ accordion (JS `toggleFaq()` with CSS `max-height` transition)

### SEO / AEO
- `canonical`: `https://gecktool.com/Chinese-Slang-Translator/`
- `meta description`: keyword-rich, includes "Chrome extension" + "Free to start"
- **`SoftwareApplication` JSON-LD**: name, operatingSystem, applicationCategory, offers (price: 0 + $4.99/mo), publisher
- **`FAQPage` JSON-LD**: 6 Q&A pairs — directly consumed by Google AI Overview / Perplexity / ChatGPT Search
- Open Graph + Twitter Card

---

## Page 3 — Legal (`/Chinese-Slang-Translator/legal.html`)

**Purpose:** Single page containing all legal documents. Linked from product page footer.

### Contents
1. **Privacy Policy** — Full inventory table of 7 data items (selected text, context, URL, license token, install ID, whitelist, hint-dismissed list). Notes on protection measures (HTTPS, JWT, XML tag sanitization, prompt injection defense). Third-party services table (Bedrock, DynamoDB, API Gateway).
2. **Terms & Conditions** — License grant, permitted/prohibited use, free plan limitations, disclaimers, governing law.
3. **Refund Policy** — 7-day full refund, eligibility table, request process.
4. **Contact** — hello@mandrain.app

### Footer Links (product page → legal.html)
- Privacy Policy → `./legal.html#privacy`
- Terms of Use → `./legal.html#terms`
- Refund Policy → `./legal.html#refund`

---

## Navigation & URL Routing

All links use **relative paths** for compatibility with both:
- Local Live Server: `http://127.0.0.1:5500/web_site/`
- S3 static hosting: `http://mandrain-website-dev.s3-website-us-east-1.amazonaws.com/`
- Production: `https://gecktool.com/`

| From | To | Link |
|------|----|------|
| Homepage | Product page | `./Chinese-Slang-Translator/` |
| Product page | Homepage | `../` |
| Product page | Legal | `./legal.html#section` |
| Legal page | Product page | `./` |
| Legal page | Homepage | `../` |

---

## Deployment

### Infrastructure
- **S3 bucket**: `mandrain-website-{env}` (dev / prod)
- **Static website hosting**: index.html as default document
- **Public read**: bucket policy allows `s3:GetObject` on `/*`

### Cache Strategy (set via `aws s3 sync`)
| File type | Cache-Control |
|-----------|---------------|
| `*.html` | `no-cache, max-age=0` (always revalidated) |
| `*.css`, `*.js` | `public, max-age=31536000, immutable` (1 year) |
| Images / other | `public, max-age=604800` (1 week) |

### GitHub Actions Trigger
```yaml
on:
  push:
    branches: [dev]
    paths: ['web_site/**']   # auto-deploy on dev push
  workflow_dispatch:         # manual trigger for prod
    inputs:
      environment: [dev, prod]
```

---

## Security Notes
- No user input on any web page (static only)
- No client-side JS that makes external requests
- All API calls originate from the Chrome extension, not the website
- Prompt injection defenses implemented at backend level (not web layer)
