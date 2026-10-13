# Phone alerts (5 am surf check)

The site publishes a small JSON file that your phone can read every morning and decide whether to notify you:

```
https://21stcheran.github.io/serenity-surf/api/alert.json
```

It is rebuilt every 3 hours, plus a dedicated run at 03:30 IST so it is fresh before 5 am.
(GitHub's scheduler can run up to ~30 minutes late at busy times — the `generated_at` field tells you how old it is.)

## What's in it

| field | example | meaning |
|---|---|---|
| `notify` | `true` | Good+ session still to come today, or cyclone swell due within 72 h |
| `notify_great` | `false` | stricter: Great/Epic session or cyclone swell |
| `level` | `"good"` | `none` · `good` · `great` · `epic` · `cyclone` |
| `title` | `"Serenity: Good surf 06:30–08:30"` | ready-made notification title |
| `message` | `"06:30–08:30 · 5.7/10 · 3–4 ft @ 13 s SE · 10 kt cross-shore · tide high"` | ready-made body |
| `score` | `5.7` | today's best remaining session (0–10) |
| `today`, `tomorrow`, `next_great` | `{start, end, score, label, face_ft, period_s, swell_dir, wind_kt, wind_type, tide, summary}` | best windows |
| `cyclone` | `{active, name, category, distance_km, swell_eta, expected_face_ft}` | live cyclone swell, if any |
| `generated_at` | `"2026-10-13T22:05:00Z"` | build time (UTC) |

Scores use the default **6'10 all-rounder** profile (clean 3 ft = Good). If you want your own threshold, compare `score` yourself instead of using `notify`.

Other files in the same folder: `now.json` (current conditions), `forecast.json` (16-day daily summary), `cyclones.json` (live storms, JTWC invests, IMD alerts).

## iPhone (Shortcuts app)

1. Open **Shortcuts → Automation → + → Time of Day**. Pick **5:00 AM**, **Daily**, and choose **Run Immediately** (turn off "Notify When Run").
2. Add action **Get Contents of URL** → paste the URL above.
3. Add **Get Dictionary Value** → Key: `notify` → from *Contents of URL*.
4. Add **If** → *Dictionary Value* **is** `true` (Shortcuts shows booleans as 1/0; "is 1" also works).
5. Inside the If, add two more **Get Dictionary Value** actions for `title` and `message` (from *Contents of URL*), then **Show Notification** with *title* as the title and *message* as the body.
6. Optional: add **Open URLs** → `https://21stcheran.github.io/serenity-surf/` so tapping takes you to the dashboard.

Want only big days? Use `notify_great` instead of `notify`, or get `score` and use **If score is greater than 6.5**.

Cyclone-only alerts: get `level` and check **is** `cyclone`.

## Android

**MacroDroid** (free):
1. Trigger: **Day/Time → 05:00**, every day.
2. Action: **HTTP Request** (GET) → the URL above, save the response to a string variable `surf`.
3. Constraint/If: **Text matches** `surf` contains `"notify":true`.
4. Action: **Notification** → title `Serenity surf`, text `{lv=surf}` — or use MacroDroid's *JSON Parse* action to pull `title` and `message`.

**Tasker**: Time profile 05:00 → *HTTP Request* → *JavaScriptlet* `var a = JSON.parse(http_data); setLocal('n', a.notify); setLocal('t', a.title); setLocal('m', a.message);` → *If %n ~ true* → *Notify* `%t` / `%m`.

## Notes

- Nothing personal is stored online. Your session log stays in your browser; the alert always uses the default profile.
- If the feed looks stale (`generated_at` older than ~6 hours), the GitHub Action may be paused — open the repo's **Actions** tab and re-run "Refresh data and deploy".
