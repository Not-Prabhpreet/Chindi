# Chindi — Build Spec

Nov 2, 2026 · @Prabh

## Overview

Chindi is a manual-entry budgeting PWA that roasts you (lovingly) into not wasting money. It is built for one person first, open source, and designed so friends can self-host or join later.

**Who it's for:** Gen Z, phone-first, short attention span, spends on impulse (late-night carts, takeout, "I deserve this" buys). No bank linking: every expense is typed by hand, on purpose, because typing it makes you think about it.

**Stack:** FastAPI + PostgreSQL (or SQLite) backend, React + Vite + TypeScript frontend, installed on the phone as a PWA.

**Product principles (the AI agent must follow these when making any decision not covered here):**

1. **Logging takes under 5 seconds.** Amount, category, account. Everything else is optional or happens later in Swipe Sunday.
2. **Never show money as an allowance.** No "safe to spend" numbers. Show what you *kept*, what's *left in a category*, and how you compare to last month.
3. **Every insight is one plain sentence.** No heatmaps, no charts that need a legend. If it can't be said in one sentence, it doesn't ship.
4. **Personality lives in headings, quips, celebrations and empty states.** Numbers, buttons and forms stay plain and clear.
5. **No AI at runtime.** All quips, personalities and insights come from rules + templates in our own code.
6. **Depth is opt-in.** Extra features (cost per use, subscriptions, rules) can be switched off in Settings and never clutter the logging flow.
7. **Multi-user ready, single-user first.** Every table has a `user_id`; sign-ups are off by default.

## Mockups

These six screens and the logo are the visual source of truth; match their layout, spacing and copy. The live, editable versions are on the design canvas. Standalone HTML copies and PNGs are in the repo at `design/mockups/` and `design/png/` so the agent can open them.

| Screen | PNG | HTML |
|---|---|---|
| Logo and app icon | `design/png/00-logo-and-icon.png` | `design/mockups/00-logo-and-icon.html` |
| Home | `design/png/01-home.png` | `design/mockups/01-home.html` |
| Quick add | `design/png/02-quick-add.png` | `design/mockups/02-quick-add.html` |
| About to buy | `design/png/03-about-to-buy.png` | `design/mockups/03-about-to-buy.html` |
| Swipe Sunday | `design/png/04-swipe-sunday.png` | `design/mockups/04-swipe-sunday.html` |
| Insights | `design/png/05-insights.png` | `design/mockups/05-insights.html` |
| Wishlist | `design/png/06-wishlist.png` | `design/mockups/06-wishlist.html` |

**Logo and app icon.** Ship the bubblegum version (B). The side-eye coin is also the in-app mascot.

**Home.** Quip bubble from the coin, Kept-this-month hero, About-to-buy button, flexible categories with progress bars (tap a row to add with that category; chevron expands subcategories), fixed bills collapsed, floating + button, 5-tab nav.

**Quick add.** Bottom sheet. Opens with the number pad ready and the category pre-filled when launched from a category row. Merchant and account chips are "recently used". Feeling is optional.

**About to buy.** Item and price, note from past you plus goal jar progress, regret history for that category, broken rules, reasons for and against. Primary action sends it to the wishlist.

**Swipe Sunday (weekly review).** One card per purchase from last week. Swipe right = worth it, left = regret. Trigger tags and need/want/waste are filled here, not at logging time.

**Insights.** Wrapped banner on top, then one-sentence insight cards, each with at most one simple visual.

**Wishlist.** Money-not-wasted total, items whose timer finished (decide now), items still waiting.

**Not drawn yet (build from the design system in this doc):** onboarding (quiz swipe cards, personality card), Wrapped story slides, Goals, Rules, Settings, accounts, transaction history, login.

## Feature spec

Thirty features across four phases; each phase is usable on its own. The "Done when" column is the acceptance test the agent should verify before moving on.

| Phase | Feature | What it does | Done when |
|---|---|---|---|
| 1 | Auth | Email + password (argon2). Sign-ups off unless `ALLOW_SIGNUPS=true`. Access token 15 min, refresh token 60 days in an httpOnly cookie. | You stay logged in on the phone for weeks; a second sign-up is refused by default. |
| 1 | Accounts | Chequing, savings, credit card, cash, other. Opening balance, current balance computed from transactions. | Transfers and card payments move money between accounts and never count as spending. |
| 1 | Categories | Two levels (category > subcategory). Each is fixed or flexible. Limit is a dollar amount, a count per month, or none. Icon + pastel colour. | Defaults seeded; user can add, rename, reorder, archive. |
| 1 | Quick add | Amount pad, category, account, merchant, optional feeling, optional note, date defaults to today. Opens from + button or a category row (pre-filled). | A typical expense takes 3 taps after the amount; saved offline and synced later. |
| 1 | Home | Quip bubble, Kept this month, daily average vs last month, no-spend streak, flexible categories with left/limit and bars, fixed bills collapsed. | Numbers match the formulas in Calculations. |
| 1 | History | Searchable list of transactions, grouped by day, edit and delete, filter by category and account. | Editing an old expense updates all totals. |
| 1 | Income | Log income to an account. | Income never counts as spending or as "kept". |
| 1 | PWA | Manifest, icons, service worker, offline shell, "add to home screen". | Installs on iOS and Android and opens full screen. |
| 2 | Onboarding | Hello, personality quiz, result card, tone, accounts, budget, goal + note, account creation, install + notifications, first log. All skippable. | Fresh install to Home in under 2 minutes. |
| 2 | Personality quiz | 6 swipe cards, scored to one of 6 personalities. Drives budget defaults, quip weighting and which nudges are on. Retake from Settings. | Result card shareable as a 1080×1920 PNG. |
| 2 | Quip engine | Rules + templates, Sweet or Savage tone, rotation without repeats. | See the Quip engine section. |
| 2 | Feeling rating | Love / Good / Meh / Regret at purchase (optional). | Stored per transaction. |
| 2 | About to buy | Item + price, past-you note, goal impact, category regret history, broken rules, reasons for/against. Buttons: wait (to wishlist) or buy anyway (opens quick add pre-filled). | Each outcome is logged so Wrapped can count "pauses that worked". |
| 2 | Wishlist | Items with a cooling-off timer: 72 h under $100, 7 days $100–$300, 30 days over $300 (editable). When the timer ends: still want it or let it go. | Let-go amounts add up to Money not wasted. |
| 2 | Goal jars | Savings goals with target, saved amount, optional date, note to future you. Money not wasted can be moved into a jar. | Jar progress shows on Home and About to buy. |
| 2 | Swipe Sunday | Cards for last week's flexible expenses: worth it / regret, trigger tags, need/want/waste. Wishlist items with finished timers appear too. Ends with a balance check per account. | Available from Sunday 00:00 until reviewed; reminder on Home. |
| 2 | No-spend grid | Calendar grid; a day is green if no flexible spending was logged. Streak counter. | Grid on Goals tab; streak on Home. |
| 3 | Insights | Sentence cards from fixed insight rules (see Calculations). | Only cards with enough data show (min 10 transactions). |
| 3 | Rules | Count limits, "no {category} until {date}", custom one-liners. Purchases that break a rule are flagged. | Broken rules show on About to buy and in quips. |
| 3 | Payday plan | When income is logged, prompt to split it across jars, sinking funds and bills. | Split is recorded as transfers. |
| 3 | Sinking funds | Irregular costs (gifts, insurance, renewals) with a target and due date; monthly amount suggested. | Paying the cost from the fund doesn't hurt the month's "kept". |
| 3 | Levels | Shopaholic, Recovering, Chindi, Ultra Chindi based on points. | Level-up shows a celebration once. |
| 3 | Notifications | Web push: evening log nudge (opt-in, time chosen), Swipe Sunday, wishlist timer done, Wrapped ready. | Works on an installed iOS PWA. |
| 4 | Wrapped | Story slides on the 1st of the month for the previous month. | Each slide exports as a share card with a "hide my numbers" toggle. |
| 4 | Subscriptions | Recurring charges with cycle, next date, monthly "did you use it?" check. | Unused 2 months in a row is called out. |
| 4 | Cost per use | Optional on any purchase: log each use, show cost per use. | Off by default; toggled per transaction. |
| 4 | Habit cost | Merchants seen 3+ times a month get a yearly projection insight. | Appears only in Insights. |
| 4 | Fresh start | Prompts on the 1st, the user's birthday and New Year to review and reset rules. | One dismissible card on Home. |
| 4 | Export | CSV and JSON export of all data from Settings. | Re-import restores everything. |
| 4 | Settings | Tone, currency, week start, feature toggles, notification times, data export, logout. | Every opt-in feature can be turned off. |

## User flows

Six flows cover the whole app. Every screen does one thing, and every step in onboarding can be skipped.

### Navigation

Tabs: **Home · Insights · Wishlist · Goals · Rules**. Floating **+** on Home, Insights and Goals. Settings from the top-right button on Home. Swipe Sunday and Wrapped open from cards on Home and Insights.

### 1. Onboarding (target: under 2 minutes)

1. **Hello.** The coin side-eyes you: "Hi, I'm Chindi. I'm here to judge your spending. Lovingly." Button: Let's go.
2. **Personality quiz.** 6 swipe cards (right = that's me, left = never). This teaches the swipe gesture used in Swipe Sunday.
3. **Your result.** Personality card with a Share button.
4. **Pick a vibe.** Sweet or Savage.
5. **Money spots.** Tap the accounts you have, type each balance.
6. **Budget.** Suggested categories pre-filled from the personality; toggle off, drag sliders, mark fixed bills.
7. **Your why.** First goal jar + one-line note to future you.
8. **Save your stuff.** Create the account (email + password). Everything before this is held in local storage and posted on sign-up.
9. **Install + notifications.** "Put me on your home screen. I'll be watching." Explain, then ask for push permission.
10. **First log.** Opens quick add: "Spent anything today?" If skipped: "Nothing? Who even are you?" and confetti.

### 2. Log an expense

1. Tap **+** (or a category row, which pre-fills the category).
2. Type the amount on the pad.
3. Pick category (if not pre-filled), merchant chip, account chip. Last-used values are pre-selected.
4. Optional feeling. Tap **Add**.
5. Back on Home: totals update, the quip bubble may change, a light haptic + coin bounce.

### 3. Tempted to buy

1. Tap **About to buy something?** on Home.
2. Enter the item and price. The screen fills in past-you note, goal impact, category regret history and broken rules.
3. Optional reasons for and against.
4. **Wait** → item goes to the wishlist with a timer → when it ends, it shows in Wishlist and in Swipe Sunday → **Let it go** (adds to Money not wasted, quip, coin drop) or **Still want it** (opens quick add pre-filled).
5. **Buy it anyway** → quick add pre-filled; the purchase is tagged `impulse_override` for Wrapped.

### 4. Swipe Sunday

1. From Sunday, Home shows a card: "Swipe Sunday is ready. 11 purchases to judge."
2. One card per flexible expense from Mon–Sun, oldest first. Swipe right = worth it, left = regret (buttons too).
3. Optional trigger tags and need/want/waste on each card.
4. Wishlist items with finished timers appear as cards: right = still want, left = let go.
5. Balance check: for each account, "Does your balance say $X?" Yes, or type the real number (creates an adjustment transaction).
6. Done screen: "Books balanced. Go touch grass." + this week's worth-it rate.

### 5. Wrapped (1st of each month)

Tap-through story slides, like Instagram stories (tap right = next, left = back, hold = pause):

1. Your month in one number: total kept.
2. Biggest regret (largest regretted purchase).
3. Best decision (largest let-go wishlist item).
4. Top trigger tag and the day of the week you regret most.
5. Money not wasted + pauses that worked.
6. Your title for the month (based on the dominant pattern) + level progress.
7. Share: pick a slide, toggle "hide my numbers" (amounts become percentages), export a 1080×1920 PNG.

### 6. Payday

1. Log income.
2. Prompt: "Payday! Where's it going before you spend it?" Shows jars, sinking funds and fixed bills with suggested amounts.
3. Confirm the split; it's recorded as transfers. Skip is always available.

## Quip engine and personality quiz

Every bit of personality is a rule + a template filled from the user's own data. No AI, no network calls. The engine lives in `backend/app/quips/` as plain Python so it's easy to test and to add lines.

### How the quip engine works

1. **Events** call the engine: `app_open`, `transaction_created`, `wishlist_let_go`, `wishlist_bought`, `review_done`, `level_up`, `goal_reached`.
2. Each **rule** has: `id`, `events` it listens to, a `condition(ctx) -> bool`, a `priority` (1–100), a `cooldown_hours`, and `templates = {"sweet": [...], "savage": [...]}`.
3. The engine collects matching rules, drops those inside their cooldown, takes the highest priority, and picks a template variant not used in the last 3 times (`quip_log` table).
4. Slots in `{braces}` are filled from `ctx`. Money is formatted with the user's currency.
5. Result: `{rule_id, text, mood}` where `mood` = `happy | smug | judging | shocked` drives the coin's face.
6. Nothing matches → a neutral line for the time of day ("Morning. Wallet still closed? Respect.").

**Slots:** `{category}` `{subcategory}` `{merchant}` `{amount}` `{over}` `{left}` `{nth}` `{count}` `{days}` `{weekday}` `{time}` `{goal}` `{saved}` `{percent}`.

### Starter rules (aim for 3–4 variants per tone before launch)

| Rule | Fires on | Condition | Sweet | Savage |
|---|---|---|---|---|
| `over_limit` | transaction_created, app_open | a flexible category is over its limit | "{category} went ${over} over. Tomorrow's a fresh start." | "{category} is ${over} over. Money doesn't grow on trees, bestie." |
| `near_limit` | transaction_created | category ≥ 85% used | "Heads up: only ${left} left in {category}." | "${left} left in {category}. Choose wisely." |
| `count_limit_last` | transaction_created | count limit has 1 left | "Last {subcategory} of the month. Make it count." | "One {subcategory} left. ONE." |
| `late_night_repeat` | transaction_created | logged 22:00–04:00 and nth ≥ 2 in that category this month | "Late-night {category} again. Sleep might be cheaper." | "Your {nth} late-night {category} this month. Just saying." |
| `same_merchant` | transaction_created | same merchant ≥ 3 times this week | "{merchant} must really like you." | "{merchant} again? Are you an investor?" |
| `streak` | app_open | no-spend streak ≥ 3 | "{days} days with no extra spending. Proud of you." | "{days} days, $0 spent. Certified chindi." |
| `let_go` | wishlist_let_go | always | "+${amount} saved. That's growth." | "+${amount} saved. Look at you go." |
| `bought_anyway` | wishlist_bought | always | "Enjoy it. You waited, that counts." | "Fine. I'll remember this." |
| `review_done` | review_done | always | "All caught up. Nice work this week." | "Books balanced. Go touch grass." |
| `empty_day` | app_open | nothing logged today and it's after 18:00 | "Nothing spent today? Love that." | "Nothing spent today? Who even are you?" |
| `payday` | transaction_created (income) | income ≥ $200 | "Payday! Let's give it a plan." | "Payday. Don't get ideas." |
| `goal_close` | app_open | a goal ≥ 90% | "{goal} is {percent}% there!" | "{goal} is {percent}% done. Don't you dare." |

### Personality quiz

Six cards. Swiping right adds 2 points to the card's personality. Every left swipe adds 1 to Secret Chindi. Highest score wins; ties go to the earlier personality in the table. The result is stored on the user and can be retaken from Settings.

| Card | Right swipe scores |
|---|---|
| "Add to cart at 2 am?" | Midnight Cart Goblin |
| "'I deserve this' after a bad day?" | Treat Yourself Repeat Offender |
| "A $7 coffee every single morning?" | Latte Leak |
| "A subscription you forgot you have?" | Subscription Hoarder |
| "Can't say no when friends say 'let's go out'?" | Social Butterfly (Wallet Moth) |
| "You check your balance before buying gum?" | Secret Chindi |

### What the personality changes

| Personality | Card line | Budget defaults | Turned on by default |
|---|---|---|---|
| Midnight Cart Goblin | "Your cart does its best work after midnight." | Shopping limit 20% lower | `late_night_repeat` priority up; 10 pm "step away from the cart" push |
| Treat Yourself Repeat Offender | "Every bad day comes with a receipt." | Fun and Shopping split out | Trigger tags shown first in Swipe Sunday; About to buy shows the past-you note larger |
| Latte Leak | "Small sips, big leak." | Coffee and Takeout as count limits | Habit cost insight; `same_merchant` priority up |
| Subscription Hoarder | "You're paying for things you forgot exist." | Subscriptions category created | Subscriptions feature on; monthly "did you use it?" |
| Social Butterfly (Wallet Moth) | "Can't say no, can't stop paying." | Food out and Fun limits | `social` tag pre-listed; Friday-evening nudge |
| Secret Chindi | "You were born for this app." | Standard | Savage tone suggested; streaks and levels on Home |

The personality also seeds Wrapped: each month's title compares behaviour to the starting personality ("Started as a Midnight Cart Goblin. Now: Recovering.").

## Design system

Chunky and playful: near-black 2px outlines, hard offset shadows, mango as the main colour, bubblegum for fun moments, tomato only for "over". All text is dark on light, so it stays easy to read.

### Colours

| Token | Hex | Used for |
|---|---|---|
| `ink` | #17141F | Text, outlines, shadows, normal progress fill, dark buttons |
| `ink-soft` | #4A4553 | Secondary text, labels (passes 4.5:1 on paper) |
| `paper` | #FFFBF3 | App background |
| `card` | #FFFFFF | Cards, sheets, tab bar |
| `line` | #EDE6D8 | Dividers inside cards |
| `track` | #F1EBDF | Empty part of progress bars, segmented controls |
| `mango` | #FFC93C | Primary: hero card, + button, main CTAs, active tab, highlighter |
| `mango-soft` | #FFE3A3 | Near-limit pills, quip highlights |
| `bubblegum` | #FF8FB1 | Fun moments: Wrapped, review progress, About-to-buy shadow, app icon |
| `bubblegum-soft` | #FFD1DE | Ready-to-decide wishlist card, category tile |
| `sky-soft` | #CDE3FF | Category tile, Love/Good dot |
| `tomato` | #F2542D | Over-limit bar fill, Regret dot |
| `tomato-text` | #C2381A | Over-limit amounts (text) |
| `tomato-soft` | #FFB3A1 / #FFF1EC | Regret button, over-limit row background |

Progress bar colour: under 85% = `ink`, 85–100% = `mango`, over 100% = `tomato`.

### Type

- **Display:** Bricolage Grotesque 600/700/800 for headings, big numbers, buttons. Tight letter-spacing (−0.5 to −2px on large sizes).
- **Body:** DM Sans 400–700 for everything else.
- Scale: 58 (amount entry), 46 (hero number), 30 (screen titles), 22 (card titles), 17 (section titles), 15 (body), 13 (labels), 12 (captions), 11 (tab labels). Use `font-variant-numeric: tabular-nums` on money.

### Shape and depth

- Radius: 20 hero, 16 cards and buttons, 12 chips and inputs, 10 small pills.
- Borders: 2px `ink` on cards and buttons; 1.5px on chips, tiles, inputs, bars.
- Shadows: hard, no blur. `3px 3px 0 ink` on cards and buttons, `4px 4px 0` on hero cards, `2px 2px 0` on keys. Pressed state: translate 2px down-right and drop the shadow.
- Spacing on a 4/8 grid: 16 side gutters, 12 between cards, 20 screen top padding.
- Touch targets ≥ 44px.

### Components

Card · HeroCard · Button (primary mango, dark ink, ghost) · Chip (selectable) · AmountPad · ProgressBar (3 states) · CategoryRow (expandable) · QuipBubble (coin + speech bubble with tail) · Coin mascot (moods: happy, smug, judging, shocked) · BottomSheet · SwipeCard stack · TabBar · InsightCard (sentence + optional mini visual) · StorySlide (Wrapped) · Toast.

### Motion

- Coin bounces 6px on a logged expense; drops into a jar on let-go or goal deposit.
- Swipe cards follow the finger, rotate up to 12°, fly off at 30% screen width.
- Respect `prefers-reduced-motion`: replace movement with fades.

### CSS variables (put in `frontend/src/styles/tokens.css`)

```css
:root {
  --ink: #17141F; --ink-soft: #4A4553;
  --paper: #FFFBF3; --card: #FFFFFF; --line: #EDE6D8; --track: #F1EBDF;
  --mango: #FFC93C; --mango-soft: #FFE3A3;
  --bubblegum: #FF8FB1; --bubblegum-soft: #FFD1DE;
  --sky-soft: #CDE3FF; --mint-soft: #D8F1F0;
  --tomato: #F2542D; --tomato-text: #C2381A; --tomato-soft: #FFB3A1; --tomato-wash: #FFF1EC;
  --radius-hero: 20px; --radius-card: 16px; --radius-chip: 12px;
  --shadow-card: 3px 3px 0 var(--ink); --shadow-hero: 4px 4px 0 var(--ink);
  --font-display: 'Bricolage Grotesque', system-ui, sans-serif;
  --font-body: 'DM Sans', system-ui, sans-serif;
}
```

Dark mode is out of scope for v1; build with tokens so it can be added later.

## Tech stack and repo structure

One monorepo, two apps, one Docker Compose file. Use the latest stable version of each library at the time you start.

| Layer | Choice | Why |
|---|---|---|
| API | FastAPI + Pydantic v2 | Typed, fast, auto OpenAPI docs the frontend can generate types from |
| ORM + migrations | SQLAlchemy 2 (or SQLModel) + Alembic | Standard; migrations from day one |
| Database | PostgreSQL in Docker; SQLite allowed for local dev | Money as `NUMERIC(12,2)`, never float |
| Auth | argon2-cffi + PyJWT | Password hashing + access/refresh tokens |
| Scheduled jobs | APScheduler inside the API process | Wishlist timers, Swipe Sunday, Wrapped, push |
| Push | pywebpush + VAPID keys | Web push to the installed PWA |
| Frontend | React + Vite + TypeScript | Fast dev, small bundle |
| Routing / data | React Router + TanStack Query | Caching, optimistic updates for quick add |
| Styling | Tailwind CSS reading the CSS variables in tokens.css | Speed, while staying on-brand |
| Motion | Motion (formerly Framer Motion) | Swipe cards, coin animations |
| PWA | vite-plugin-pwa (Workbox) | Manifest, service worker, offline |
| Offline queue | IndexedDB (idb-keyval) | Quick add works with no signal, syncs later |
| Share cards | html-to-image | Wrapped and personality cards to PNG |
| Tests | pytest, Vitest, Playwright | Unit, component, end-to-end |
| Hosting | Docker Compose: `db`, `api`, `web` (Caddy serving the build + HTTPS) | One command to self-host |

```
chindi/
  CLAUDE.md
  docker-compose.yml
  .env.example
  design/
    mockups/          # standalone HTML screens + fonts
    png/              # screenshots of each screen
  backend/
    pyproject.toml
    alembic/
    app/
      main.py         # app factory, routers, CORS, scheduler start
      config.py       # settings from env
      db.py
      models/         # SQLAlchemy models, one file per table group
      schemas/        # Pydantic request/response models
      routers/        # auth, accounts, categories, transactions, wishlist,
                      # goals, reviews, insights, rules, wrapped, quips, settings
      services/       # calculations.py, insights.py, wrapped.py, levels.py
      quips/          # engine.py, rules.py, templates.py
      quiz/           # cards.py, scoring.py, personalities.py
      jobs/           # scheduled jobs
    tests/
  frontend/
    package.json
    vite.config.ts
    public/icons/     # app icons, maskable, apple-touch-icon
    src/
      main.tsx
      app/            # router, providers, layout, tab bar
      api/            # generated client + TanStack Query hooks
      components/     # design-system components
      features/       # home, quick-add, about-to-buy, wishlist, review,
                      # insights, goals, rules, onboarding, wrapped, settings
      lib/            # money formatting, dates, offline queue
      styles/tokens.css
```

## Data model

Sixteen tables. Every table except `users` has `user_id` (FK, indexed) plus `created_at` and `updated_at`. IDs are UUIDs. Money is `NUMERIC(12,2)` in the user's currency. Dates are stored in UTC; "today", weeks and months are computed in the user's time zone.

```
users
  id, email (unique), password_hash, display_name, timezone, currency (default CAD),
  week_start (default monday), tone (sweet|savage), personality (enum, nullable),
  nudge_time (nullable), level_points (int), onboarding_done (bool),
  feature_flags (json: rules, subscriptions, cost_per_use, sinking_funds, ...)

refresh_tokens
  id, user_id, token_hash, expires_at, revoked_at, user_agent

accounts
  id, user_id, name, kind (chequing|savings|credit|cash|other),
  opening_balance, archived (bool), sort_order

categories
  id, user_id, parent_id (nullable, one level only), name, icon, color_token,
  kind (fixed|flexible), limit_type (amount|count|none), limit_amount, limit_count,
  sort_order, archived

transactions
  id, user_id, kind (expense|income|transfer|adjustment),
  amount (always positive), occurred_at (timestamptz),
  account_id, to_account_id (transfers only),
  category_id (expenses only), merchant (text, nullable), note,
  feeling_at_purchase (love|good|meh|regret, nullable),
  review_verdict (worth_it|regret, nullable), reviewed_at,
  need_want (need|want|waste, nullable), trigger_tags (text[]),
  source (quick_add|about_to_buy|wishlist|payday|balance_check|import),
  impulse_override (bool), track_uses (bool), client_id (uuid, for offline dedupe)

uses                      -- cost per use
  id, user_id, transaction_id, used_at

wishlist_items
  id, user_id, name, price, category_id, reasons_for (text[]), reasons_against (text[]),
  wait_until, status (waiting|ready|let_go|bought), decided_at, transaction_id (if bought)

goals                     -- jars and sinking funds
  id, user_id, kind (jar|sinking_fund), name, target_amount, saved_amount,
  due_date, note_to_future_self, is_primary (bool), archived

goal_deposits
  id, user_id, goal_id, amount, source (manual|let_go|payday|month_leftover), created_at

rules
  id, user_id, kind (count_limit|no_buy_until|custom), category_id, max_count,
  until_date, text, active

subscriptions
  id, user_id, name, amount, cycle (weekly|monthly|yearly), next_charge_date,
  category_id, last_used_check, used_last_check (bool), active

weekly_reviews
  id, user_id, week_start_date, completed_at, worth_it_count, regret_count

wrapped_months
  id, user_id, month (date, first of month), data (json snapshot of all slides), seen_at

quip_log
  id, user_id, rule_id, variant_index, shown_at

push_subscriptions
  id, user_id, endpoint, p256dh, auth, created_at

fresh_start_prompts
  id, user_id, kind (month|birthday|new_year), shown_for (date), dismissed_at
```

Rules of thumb for the agent: soft-delete with `archived` for accounts, categories and goals; hard-delete only transactions; never store computed totals except the Wrapped snapshot.

## API endpoints

REST under `/api/v1`, JSON in and out, all routes except auth require a bearer token. List endpoints take `?from=&to=` dates and `?limit=&cursor=`. Generate the frontend client from `/openapi.json`.

| Method | Path | Purpose |
|---|---|---|
| POST | /auth/register | Create account (only if sign-ups allowed or no users exist) |
| POST | /auth/login | Returns access token, sets refresh cookie |
| POST | /auth/refresh | New access token from cookie |
| POST | /auth/logout | Revoke refresh token |
| GET / PATCH | /me | Profile, tone, timezone, currency, feature flags |
| POST | /onboarding/complete | Accepts the whole onboarding payload (quiz answers, accounts, categories, first goal) in one call |
| GET | /quiz/cards | The six cards |
| POST | /quiz/score | Answers → personality + card text |
| GET / POST / PATCH / DELETE | /accounts, /accounts/{id} | Accounts with computed balance |
| GET / POST / PATCH / DELETE | /categories, /categories/{id} | Two-level tree; `?with_usage=month` adds spent, left, count used |
| GET / POST / PATCH / DELETE | /transactions, /transactions/{id} | Expenses, income, transfers. POST is idempotent on `client_id` |
| GET | /merchants/recent?category_id= | Last 5 merchants for the chips |
| GET | /home | One call for the Home screen: kept, daily average, last month's average, streak, categories with usage, fixed summary, quip, review-ready flag |
| POST | /about-to-buy/preview | Item + price → goal impact, regret history, broken rules |
| GET / POST / PATCH | /wishlist, /wishlist/{id} | Items and timers |
| POST | /wishlist/{id}/decide | `let_go` or `buy` (buy returns a pre-filled transaction draft) |
| GET / POST / PATCH | /goals, /goals/{id} | Jars and sinking funds |
| POST | /goals/{id}/deposit | Move money in |
| GET | /reviews/current | Cards for last week + ready wishlist items + accounts to check |
| POST | /reviews/current/verdicts | Batch of verdicts, tags, need/want |
| POST | /reviews/current/complete | Balance confirmations/adjustments; returns done-screen stats + quip |
| GET | /insights?period=month | Sentence cards with any mini-chart data |
| GET / POST / PATCH / DELETE | /rules, /rules/{id} | Rules |
| GET / POST / PATCH | /subscriptions, /subscriptions/{id} | Subscriptions |
| POST | /transactions/{id}/uses | Log a use (cost per use) |
| GET | /streaks | No-spend grid for a month + current and best streak |
| GET | /wrapped/{yyyy-mm} | Wrapped slides (generated on the 1st, stored) |
| POST | /quips/next | Event name → quip text + coin mood |
| POST | /push/subscribe | Save a web push subscription |
| GET | /export?format=csv\|json | Full data export |

Errors: `{"error": {"code": "limit_exceeded", "message": "..."}}` with a proper HTTP status.

## Calculations

All numbers come from these definitions; put them in `backend/app/services/calculations.py` with unit tests for each. "Flexible spending" = expenses in flexible categories only; fixed bills, transfers, income and adjustments never count.

### Kept this month

The gap between where your flexible spending should be by today if spread evenly, and where it actually is.

```
kept = F × (d / D) − S
```

F = sum of flexible category limits for the month, d = days elapsed including today, D = days in the month, S = flexible spending so far. Positive shows "$186 under your pace"; negative shows "$40 over your pace" in tomato. On the last day this equals what's left; the app offers to move it into a jar (`goal_deposits.source = month_leftover`).

### Other numbers

| Number | Definition |
|---|---|
| Daily average | S ÷ d. Last month's = last month's flexible spending ÷ its days. Shown as "$31 · $7 less than Oct". |
| Category left | limit_amount − spent this month (parent includes its subcategories). Count limits: max_count − number of expenses. |
| Bar state | under 85% used = normal, 85–100% = near, over 100% = over |
| No-spend day | A day (user's time zone) with zero flexible expenses. Days before the account existed don't count. |
| Streak | Consecutive no-spend days ending today (today counts while still zero). Best streak stored for Wrapped. |
| Account balance | opening_balance + income − expenses ± transfers ± adjustments. Credit cards show what you owe. |
| Money not wasted | Sum of prices of wishlist items with status `let_go` (this year and all time). |
| Regret rate | regret verdicts ÷ reviewed transactions, per category, trigger tag or weekday. Show only with ≥ 3 reviewed. |
| Worth-it rate | worth_it ÷ reviewed for the week; shown on the review done screen. |
| Goal impact | price ÷ (target − saved) for the primary goal: "This would eat 7% of what's left to save." |
| Habit yearly | merchant spend over the last 90 days × (365 ÷ 90). |
| Late night | occurred_at between 22:00 and 04:00 local time. |
| Wishlist wait | under $100: 72 h; $100–$300: 7 days; over $300: 30 days (user can change per item). |

### Levels

Points: +10 per no-spend day, +2 per logged expense (rewards logging honestly, even spending), +25 per completed Swipe Sunday, +1 per $10 let go from the wishlist, +50 per goal reached. Levels at 0 Shopaholic, 300 Recovering, 900 Chindi, 2,000 Ultra Chindi. Points never go down.

### Insight rules (Insights tab)

Each rule returns one sentence or nothing. Show at most 6, ordered by how much money is involved.

1. Daily average vs last month (needs a full previous month).
2. Weekday with the most regretted money (needs ≥ 5 regrets).
3. Trigger tag with the highest regret rate (tag used ≥ 5 times).
4. Merchant total this year (≥ $100), with the habit yearly projection.
5. Worth-it rate this month vs last month.
6. Money not wasted this month + pauses that worked (About-to-buy sessions that ended on the wishlist).

## PWA, icon, notifications and hosting

Chindi must be served over HTTPS on a real domain; service workers and web push don't work without it.

### App icon (bubblegum, chosen)

Master SVG. Save as `frontend/public/icons/icon.svg` and export PNGs from it. The coin sits inside the centre 80%, so the same art works as a maskable icon.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#FF8FB1"/>
  <circle cx="50" cy="52" r="32" fill="#FFC93C" stroke="#17141F" stroke-width="4"/>
  <path d="M31 44h15M54 44h15" stroke="#17141F" stroke-width="4.5" stroke-linecap="round"/>
  <circle cx="42" cy="49" r="4.2" fill="#17141F"/>
  <circle cx="65" cy="49" r="4.2" fill="#17141F"/>
  <path d="M40 66c6 2 13 2 20-3" stroke="#17141F" stroke-width="4.5" fill="none" stroke-linecap="round"/>
</svg>
```

| File | Size | Notes |
|---|---|---|
| icon-192.png | 192×192 | `purpose: any` |
| icon-512.png | 512×512 | `purpose: any` |
| icon-maskable-512.png | 512×512 | `purpose: maskable`; full-bleed pink, no rounded corners (the OS masks it) |
| apple-touch-icon.png | 180×180 | No transparency; linked in index.html |
| favicon.svg | vector | The coin alone on transparent |

The in-app mascot is the same coin without the pink square. Moods change the eyes and mouth: happy (curved eyes, smile), smug (default side-eye), judging (angled brows, flat mouth, as on About to buy), shocked (round eyes, O mouth).

### Manifest

`name: "Chindi"`, `short_name: "chindi"`, `display: "standalone"`, `background_color: "#FFFBF3"`, `theme_color: "#FFFBF3"`, `start_url: "/"`, plus a shortcut `{ name: "Add expense", url: "/?add=1" }` so long-pressing the icon opens quick add.

### Offline

Cache the app shell and the last `/home` response. Quick add writes to an IndexedDB queue with a `client_id`; a background sync (or the next app open) posts the queue. The server ignores duplicates by `client_id`.

### Notifications

Web push with VAPID keys from env. On iPhone, push only works once Chindi is added to the home screen (iOS 16.4+), which is why onboarding asks for install first. Ask for permission only after explaining it, never on first load.

| Push | When | Example (savage) |
|---|---|---|
| Evening nudge | User's chosen time, only if nothing logged today | "Spent anything today? Log it before you forget." |
| Swipe Sunday | Sunday 11:00 local | "Swipe Sunday is ready. Time to judge your week." |
| Wishlist ready | When a timer ends | "Still want those earbuds? Decide now." |
| Wrapped | 1st of the month, 10:00 | "Your October Wrapped is out. It's a roast." |

### Hosting

- Any small VPS or a home server with Docker. `docker compose up -d` runs Postgres, the API and Caddy (which serves the built frontend and gets HTTPS certificates automatically).
- `.env`: `DATABASE_URL`, `JWT_SECRET`, `ALLOW_SIGNUPS=false`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `APP_URL`.
- Nightly `pg_dump` to a backups folder; keep 14 days.

## Build phases

Phase 1 alone is a working budget app on your phone; each later phase adds the fun on top. Each checkbox is roughly one agent session: build it, test it, commit, tick it off.

### Phase 0: Setup

- [ ] Create the repo with the structure above, `CLAUDE.md`, `.env.example`, Docker Compose
- [ ] Copy `design/mockups/` and `design/png/` into the repo
- [ ] Backend skeleton: FastAPI app, config, DB connection, Alembic, health check, pytest running
- [ ] Frontend skeleton: Vite + React + TS, Tailwind with `tokens.css`, fonts, router, tab bar shell
- [ ] Lint and format: ruff + mypy (backend), ESLint + Prettier (frontend)

### Phase 1: Usable MVP

- [ ] Auth: register (first user only), login, refresh, logout; login screen
- [ ] Accounts and categories: models, CRUD, seed defaults
- [ ] Transactions: CRUD, transfers, income, `client_id` dedupe
- [ ] `calculations.py` with tests (kept, daily average, left, streak, balances)
- [ ] `/home` endpoint
- [ ] Design-system components: Card, Button, Chip, ProgressBar, CategoryRow, BottomSheet, AmountPad, TabBar
- [ ] Home screen matching the mockup (without quips: show a static line)
- [ ] Quick add sheet, including open-from-category
- [ ] History screen with edit and delete
- [ ] PWA: manifest, icons, service worker, offline queue
- [ ] Deploy to your server and install on your phone. Use it for a week before Phase 2

### Phase 2: The personality

- [ ] Quip engine + starter rules + tests; coin mascot with 4 moods; QuipBubble on Home
- [ ] Feeling rating on quick add
- [ ] Goal jars + note to future you; Goals tab with no-spend grid
- [ ] Wishlist with timers and decide flow; Money not wasted
- [ ] About to buy screen and preview endpoint
- [ ] Swipe Sunday: card stack, verdicts, tags, wishlist cards, balance check, done screen
- [ ] Personality quiz + result share card
- [ ] Onboarding flow end to end (local storage until sign-up)

### Phase 3: Habits and insight

- [ ] Insights tab with the 6 insight rules
- [ ] Rules tab: count limits, no-buy-until, custom; broken-rule flags
- [ ] Payday plan + sinking funds
- [ ] Levels and level-up celebration
- [ ] Web push: subscribe, evening nudge, Swipe Sunday, wishlist ready

### Phase 4: Wrapped and extras

- [ ] Wrapped generation job + story slides + share cards with "hide my numbers"
- [ ] Subscriptions tracker
- [ ] Cost per use
- [ ] Habit cost insight, fresh-start prompts
- [ ] Settings: feature toggles, export, retake quiz
- [ ] Open-source polish: README with screenshots, LICENSE, self-hosting guide, sign-ups toggle documented

## CLAUDE.md and how to work with the agent

Export this doc to Markdown as `docs/SPEC.md`, put `CLAUDE.md` in the repo root, and give the agent one checkbox from Build phases per session. The repo's `CLAUDE.md` is the copy of record.

### Session prompt template

```
Read CLAUDE.md and the "<section name>" section of docs/SPEC.md.
Task: <one checkbox from Build phases, copied exactly>.
If it has a screen, open design/png/<file>.png and match it.
Make a short plan first and wait for my OK. Then build it, add tests,
run lint + tests, and commit.
```

### Tips

- **One checkbox per session.** Small tasks keep the agent accurate and the diff reviewable.
- **Start in plan mode** for anything touching the data model or calculations; read the plan before it writes code.
- **Point at the picture.** Agents match a screenshot far better than a description; always name the PNG.
- **Check the numbers yourself** after Phase 1: log a few fake expenses and compare Home against the formulas in Calculations.
- **Phase 1 first, then live with it.** A week of real use will change your mind about details; update SPEC.md before Phase 2.
- **Keep SPEC.md current.** When you change your mind, edit this doc, re-export, and tell the agent which section changed.

## Open questions

- Currency: defaulting to CAD; change in `.env` or Settings if not.
- Hosting: which server or domain will Chindi run on?
- Licence for the open-source release (MIT is the simple default).
