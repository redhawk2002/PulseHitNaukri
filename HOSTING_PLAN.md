# Hosting & Deployment Plan: ProfilePulse

This guide outlines the steps to host ProfilePulse on a cloud server so it can run 24/7 without requiring your personal laptop to be online.

## Option 1: Render (Recommended)

Render is the easiest way to host Node.js applications and has a generous free tier.

### 1. Preparation

- Ensure your code is in a **Private** GitHub repository.
- Ensure your `.env` file is **not** pushed to GitHub (it should be in `.gitignore`).

### 2. Deployment Steps

1.  **Sign up/Log in** to [Render.com](https://render.com).
2.  Click **New +** and select **Web Service**.
3.  Connect your GitHub repository.
4.  **Configure Service**:
    - **Name**: `naukri-automation`
    - **Environment**: `Node`
    - **Build Command**: `npm install`
    - **Start Command**: `npm start`
5.  **Environment Variables**:
    Click the **Advanced** or **Environment** tab and add the following:
    - `NAUKRI_EMAIL`: Your Naukri email.
    - `NAUKRI_PASSWORD`: Your Naukri password.
    - `DASHBOARD_PASSWORD`: Set a strong password for your dashboard.
    - `HEADLESS_BROWSER`: `true`
6.  **Deploy**: Click **Create Web Service**.

## Option 2: Railway

Railway is another excellent alternative with a very simple "one-click" deploy feel.

1.  Connect your GitHub repo to Railway.
2.  In the **Variables** tab, add the same environment variables listed above.
3.  Railway will automatically detect `package.json` and start the server.

## 🛠 Maintenance & Verification

- Once deployed, Render will provide a URL (e.g., `https://naukri-automation.onrender.com`).
- Log in to your new dashboard and hit **"Force Update Now"**.
- Check the **Activity Logs** on the dashboard to ensure the cloud server navigated to Naukri successfully.

> [!IMPORTANT]
> Since Render's free tier "spins down" after inactivity, your dashboard might take a few seconds to load the first time you visit it. However, the `node-cron` scheduler will continue to trigger even if the dashboard isn't open in your browser.
