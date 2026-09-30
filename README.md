# Twist Feedback

An in-app messenger and feedback widget for Twist, modelled on Featurebase's messenger, plus the service behind it and an inbox where the team triages and replies.

- **Messenger** (`src/components/twist-messenger/`): a round launcher in the corner opens a panel with four tabs.
  - **Home**: greeting, *Send us a message*, *Submit ticket → Bug Report*, *Leave us feedback*, *Search for help* with top articles, and the latest update.
  - **Messages**: conversations. When the AI assistant is on, it answers first from the help centre, logs bug reports and ideas when the parent agrees, and hands over to the team when it should (or when the parent taps *Talk to a person*). The team can read everything and reply or take over from `/admin/messages`. Replies appear in the messenger within a few seconds, and a badge on the launcher shows new ones.
  - **Help**: searchable help articles in collections, edited in `/admin/help`.
  - **Updates**: announcements, edited (and scheduled) in `/admin/updates`. A dot on the tab shows there's something new.
- **Feedback popup** (`src/components/feedback-widget/`): opened from the messenger or any button. Parents pick a category, write a title and details, choose a type (for bugs, how serious it is), can attach a screenshot of the page, and send.
- Both come in light and dark themes, in English and German.
- **API** (`src/app/api/`): validates and stores feedback and messages, checks who sent them, and limits which sites may call it.
- **Admin** (`/admin`): password-protected.
  - **Feedback**: status filters (New, Planned, In progress, Done, Won't do), search, screenshots, page and device details, and internal notes. Reports the assistant logs arrive here too, with the source `messenger-assistant`.
  - **Messages**: filters for *Needs a person*, *With AI* and *Closed*, the topic the assistant tagged, the articles it showed, a reply box, and *Take over* / *Let the AI answer*.
  - **Help centre** and **Updates**: editors for the messenger's content, in English and German.

Use it on the **parent dashboard** and the **public website** only. It is not designed for the children's app, where children's privacy rules limit what can be collected.

## Run it locally

Requires Node.js 22.13 or newer. Locally, data is kept in a SQLite file (`data/feedback.db`, created on first run) using Node's built-in SQLite.

```bash
npm install
cp .env.example .env.local   # then set ADMIN_PASSWORD
npm run dev
```

- `http://localhost:3000/` is a demo parent dashboard with the widget. Add `?theme=light` or `?locale=de` to try the light theme or German.
- `http://localhost:3000/admin` is the inbox.
- Without an Anthropic API key, everything works except the assistant: messages go straight to the team.

## Add the messenger to the Twist front end

1. Copy `src/components/twist-messenger/`, `src/components/feedback-widget/`, `src/components/icons/`, `src/components/bloub/`, `src/lib/feedback/` and `src/lib/messenger/` into the Twist repo, and install the two dependencies:

   ```bash
   npm install lucide-react modern-screenshot
   ```

2. Render the messenger once, in the dashboard layout (or the website layout). It includes the feedback popup.

   ```tsx
   import { TwistMessenger } from "@/components/twist-messenger";

   <TwistMessenger
     apiUrl="https://feedback.twist.example"   // where this service runs; omit if same app
     source="parent-dashboard"                  // or "website"
     locale={locale}                            // "en" | "de"
     theme="dark"                               // or "light"
     user={{ id: parent.id, name: parent.name, email: parent.email, hash }}
     metadata={{ appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "" }}
   />
   ```

   On the public website, leave out `user`. Visitors then chat anonymously: the messenger keeps a random token in their browser, so they see their own conversations on that device only.

   If you only want the feedback popup without the messenger, render `<FeedbackWidget source="…" />` from `@/components/feedback-widget` instead; it shows a floating "Feedback" tab.

3. Open the feedback popup from your own buttons, if you like:

   ```tsx
   <button data-twist-feedback>Give feedback</button>
   <button data-twist-feedback="bug">Report a bug</button>   // opens straight into a category
   ```

   or from code: `openFeedbackWidget("idea")`. Pass `placement={null}` to hide the floating tab.

4. **Verify who is sending feedback.** In a server component or API route of the Twist app, compute the hash with the same secret as this service:

   ```ts
   import { createHmac } from "node:crypto";
   const hash = createHmac("sha256", process.env.FEEDBACK_IDENTITY_SECRET!).update(parent.id).digest("hex");
   ```

   Posts with a valid hash show a **Verified** badge in the inbox. Never compute the hash in the browser, because that would expose the secret.

5. **Allow the Twist sites** to post by listing them in this service's `FEEDBACK_ALLOWED_ORIGINS`, for example `https://app.twist.example,https://www.twist.example`.

Categories, their icons and the type chips live in `src/lib/feedback/config.ts`. Popup text lives in `src/components/feedback-widget/strings.ts`. Messenger text and the chat's quick replies live in `src/lib/messenger/content.ts`. **Help articles and updates** are stored in the database and edited in the admin; on first run the database is filled with the starter examples from `content.ts`, so replace those with real Twist content. Article text can use blank lines for paragraphs, `- ` for lists and `**bold**`. Where the German is empty, German readers see the English. The German text is a first draft, so have the translation team review it.

**Icons.** All icons come from `src/components/icons`, which is generated from our Figma library "HC - Huge Icon", page "❖ Hugeicons Pro" (Solid, Rounded). `design/hugeicons/manifest.json` lists each icon's Figma node ids and the name the app uses for it. To download them all and rebuild:

```bash
FIGMA_TOKEN=<personal access token> node scripts/fetch-figma-icons.mjs
```

Create the token in Figma under Settings → Security → Personal access tokens, with the "File content: read" scope, and keep it out of the repo. Add `--stroke` for the outline style. To add an icon, add a row to the manifest (its node ids are on the icon's variants in Figma) and fetch again. Until an icon has been fetched, the app shows a lucide-react stand-in.

**Avatar.** The animated blob on the Home screen and in the chat is [bloub](https://github.com/jeremy-prt/bloub) by Jérémy Perret, MIT-licensed. Its engine is copied unchanged into `src/components/bloub/bot/` (commit in `UPSTREAM_COMMIT`, licence in `LICENSE`, which must stay with it); `Bloub.tsx` is our React renderer for its idle state. bloub recreates x.ai's bot avatar; its licence covers the code, not that design, so we draw it in Twist's colours.

**Header background.** The dark theme's purple header is `src/components/twist-messenger/hero.png`, generated by `node scripts/generate-messenger-hero.mjs` (edit the brightness map or tint in that script and re-run it to change it). It doesn't follow `accentColor`; the light theme uses a CSS gradient that does.

**Security of conversations.** A parent's conversations are tied to their user id only when the identity hash is valid (step 4), so they follow the parent across devices. Anyone else is tied to a random token in their browser. Knowing someone's user id or conversation id is not enough to read or post into their conversation.

## Deploy on Netlify

The repo is set up for Netlify (`netlify.toml`). Netlify runs the Next.js app on its own adapter, and storage moves to **Netlify Database** (Postgres): it's provisioned automatically because `@netlify/database` is installed, and the schema in `netlify/database/migrations/` is applied on each deploy before it goes live. Deploy previews get their own copy of the database, so testing there doesn't touch production data.

After the first deploy, set these under *Project configuration → Environment variables* (then redeploy):

- `ADMIN_PASSWORD`: required for `/admin`. Until it's set, the admin is locked.
- `ANTHROPIC_API_KEY`: turns on the AI assistant.
- `FEEDBACK_IDENTITY_SECRET`: when the Twist dashboard starts passing verified parents (step 4 above).
- `FEEDBACK_ALLOWED_ORIGINS`: the Twist sites that embed the messenger.

The demo page on a deployed site treats every visitor as anonymous (locally it signs you in as a demo parent), so testers don't see each other's conversations.

Any other Postgres works too: set `DATABASE_URL` and apply the migration files yourself.

## AI assistant

`src/server/assistant.ts`. It runs on the Claude API (model `claude-opus-5-5`, low effort, with adaptive thinking) and is on whenever `ANTHROPIC_API_KEY` is set. To turn it on, add the key to `.env.local` (or the server's environment) and restart.

What it does in a conversation:

- **Answers from the help centre only.** It searches the published articles, answers in the parent's language in a few sentences, and shows the articles it used as cards under its reply. If the help centre doesn't cover something, it says so and offers to pass it on. So the better the help articles, the better its answers.
- **Tags the topic** (question, bug, idea, content, account, praise) for the inbox.
- **Logs feedback.** For a bug, idea or content problem it asks for anything missing, offers to send it, and only after the parent agrees creates a feedback entry (linked to the conversation).
- **Hands over to a person** when asked, when the parent is upset or it's urgent (sign-in, payments, data or privacy requests, any concern about a child's safety), or when it can't help. After that it stays quiet, the header switches to *Twist team*, and the conversation shows under *Needs a person*. If the API fails, the parent is told a person will reply, and the conversation is handed over the same way.
- It can't see accounts, children's progress or payments, doesn't ask for children's personal details, and stays on the subject of Twist.

A reply from the team takes the conversation over from the assistant. *Let the AI answer* hands it back, and the assistant answers straight away if the parent is waiting. After 25 AI replies in one conversation it hands over.

**Cost.** Each reply is one to a few API calls, and the long system prompt is cached. To spend less, set `FEEDBACK_AI_MODEL=claude-sonnet-5-5`. Any other model must support adaptive thinking and the effort setting. `FEEDBACK_AI_ENABLED=false` turns the assistant off without removing the key.

**Privacy.** Conversation text is sent to Anthropic to write the replies. Cover this in the privacy notice and Anthropic data processing terms before parents use it.

## Settings

| Variable | Purpose |
|---|---|
| `ADMIN_PASSWORD` | Password for `/admin`. The inbox stays locked until it's set. |
| `ADMIN_SESSION_SECRET` | Optional. Signs admin sessions; defaults to the password. |
| `FEEDBACK_IDENTITY_SECRET` | Shared with the Twist server to verify parents (step 4). |
| `FEEDBACK_ALLOWED_ORIGINS` | Other sites allowed to post, comma-separated. |
| `DATABASE_URL` | Optional. Use this Postgres instead of SQLite. On Netlify, Netlify Database is used automatically. |
| `FEEDBACK_DB_PATH` | SQLite file location, when not on Postgres. Defaults to `./data/feedback.db`. |
| `ANTHROPIC_API_KEY` | Turns on the AI assistant. |
| `FEEDBACK_AI_MODEL` | Optional. Claude model for the assistant; defaults to `claude-opus-5-5`. |
| `FEEDBACK_AI_ENABLED` | Optional. `false` turns the assistant off even with a key. |

## Before going to production

- **Database.** All storage is in `src/server/db.ts`, which runs the same SQL on SQLite (local, or a single server with a disk) and Postgres (Netlify Database, or `DATABASE_URL`). When you change the schema, add a migration under `netlify/database/migrations/` and the matching change to the SQLite setup in `db.ts`.
- **Screenshots** are stored inside the database as images (up to about 2 MB each). Move them to object storage (for example S3) if volume grows.
- **Rate limiting** is in memory, per server instance. On Netlify each function instance counts separately, so it only slows down abuse; put a shared limiter in front if that matters.
- **Replies** reach the messenger by polling: every 8 seconds while a conversation is open (faster while the assistant is writing), and every 30 seconds otherwise, for the launcher badge. The assistant's own replies stream live. Polling is fine at tester scale; switch to server-sent events or websockets if traffic grows.
- **Nobody is notified of new messages yet.** Add an email or Teams notification to the team when a conversation needs a person (a parent writes while the team has it, or the assistant hands over: see `awaitingReply` in `src/server/db.ts`), and to parents when the team replies (in `POST /api/admin/conversations/[id]/messages`).
- **Privacy (GDPR).** Submissions can contain names, email addresses and screenshots of the dashboard. Mention the widget in the privacy notice, decide how long feedback is kept, and delete old entries on that schedule.

## Ideas for later (the long-term tool)

These follow Featurebase's product and build on the same data:

- A public board where parents vote on requests, and a roadmap built from the Planned and In progress statuses.
- A "What's new" changelog, and emails when something a parent asked for ships.
- Similar-post suggestions while typing, to avoid duplicates.
- Screenshot annotation (draw on the screenshot before sending).
- Surveys, such as the 3–7 day parent check-in, shown inside the dashboard.
