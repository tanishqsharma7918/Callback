# Callback Job Tracker — your own copy

This folder is the complete app. It needs **no account and no sign-in**, works **offline**, and keeps your
applications and resume **only on your own device**. Nothing is uploaded anywhere.

It opens with 22 fictional example applications so you can see everything working. Press
**Clear examples** on the Dashboard when you're ready to use it for real, then upload your resume in **ATS Lab**.

---

## 1. On your Mac (2 minutes)

1. Double-click the zip to unzip it. You get a folder called **Callback**.
2. Move the **Callback** folder somewhere permanent, for example your **Documents** folder.
   (Don't run it from Downloads if you clean that folder out.)
3. Open the folder and double-click **index.html**. It opens in your browser and works offline.
4. Bookmark it (⌘D) so you can get back to it.

Always open it with the **same browser** (Safari or Chrome), because each browser keeps its own copy of your data.

## 2. On your iPhone

An iPhone can't run an app straight from a zip or the Files app. iOS only shows a preview, and the buttons won't work.
So the folder needs a web address **once**. After that it lives on your Home Screen and works offline, with no sign-in.

### Step A — give it a free, permanent web address (GitHub Pages, about 10 minutes, one time)

1. Create a free account at **github.com** (this is only for hosting; the app itself never asks you to sign in).
2. Click **+** → **New repository**. Name it `callback`, choose **Public**, and click **Create repository**.
3. On the new page click **uploading an existing file**. Open your unzipped **Callback** folder, press **⌘A** to select
   **all the files inside it** (about 29, all side by side, with no subfolders) and drag them in. Wait until every file
   is listed, then click **Commit changes**. On iPhone you can also tap **choose your files**, then select all files in the folder.
4. Go to **Settings → Pages**. Under **Branch** choose **main** and **/ (root)**, then click **Save**.
5. Wait 1–2 minutes. Your app is now at **https://YOUR-USERNAME.github.io/callback/**

Your applications and resume are **not** in this upload. They stay on your phone. Only the app's code
(which contains only fictional example data) is public.

*Alternative:* any static web host works the same way (Netlify, Cloudflare Pages, your own website). Upload the
contents of the Callback folder.

### Step B — put it on your Home Screen

1. On your iPhone, open **Safari** and go to your address (e.g. `https://YOUR-USERNAME.github.io/callback/`).
2. Tap the **Share** button (the square with the arrow).
3. Scroll down and tap **Add to Home Screen** (on newer iOS you may need to tap **View More** first), then **Add**.
4. Open Callback from the new icon once while you're online. From then on it works offline, with no sign-in.

The same address also works on your Mac. In Safari use **File → Add to Dock**, or in Chrome use the **Install** icon in the
address bar, and you get an app window with its own icon.

---

## 3. Moving data between your iPhone and Mac

Each device keeps its own copy. There is no automatic sync, because sync would need an account. To move your data:

1. On the device with your latest data: **Reports & Export → Backup (.json)**.
2. Send the file to the other device (AirDrop or iCloud Drive).
3. On the other device: **Reports & Export → Restore backup** and pick the file.

You can bring over data from the claude.ai version the same way: export a backup there and restore it here.

## 4. Keep your data safe

- Export a **Backup (.json)** every week or so and keep it in iCloud Drive.
- Deleting the Home Screen app, or clearing Safari's website data, deletes the data stored in it.
- Excel and Word exports are separate files you can keep anywhere.

## 5. What works here

Everything except the Claude-powered extras:

| Works offline in this copy | Only in the claude.ai version |
|---|---|
| Dashboard, 3D pipeline tower, charts, Action Center | Claude "deep review" of a job |
| Pipeline board with drag and drop | Claude drafting cover letters, outreach and interview prep |
| Excel-style spreadsheet, Excel/Word/CSV export, Excel/CSV import | Cal's free-form conversation (here Cal uses his built-in commands) |
| Resume upload (PDF/Word/text), brutal ATS scoring, resume audit | Sync between devices |
| Add jobs from a LinkedIn link + pasted posting text | |
| Calendar, inbox parser, reports, backups | |
| **Cal** with his built-in commands: "what's due today?", "schedule a technical interview with Acme tomorrow at 2pm", "mark Acme as rejected", "export to Excel", "help" | |

## 6. Troubleshooting

- **Blank page or nothing happens on iPhone:** you're probably viewing a preview in the Files app. Use the web address in Safari (section 2).
- **Blank page on Mac:** open `index.html` from the *unzipped* folder, not from inside the zip.
- **Downloads on iPhone:** exports open the Share sheet. Choose **Save to Files**, or open the file in Excel, Word or Numbers.
- **Updating the app later:** replace the files (re-upload to GitHub). The installed app picks up the new version the next time it opens.

---

Built with Three.js, ExcelJS, JSZip, PDF.js and Mammoth (see LICENSES.md). Fonts: Bricolage Grotesque, Inter, JetBrains Mono (SIL Open Font License).
