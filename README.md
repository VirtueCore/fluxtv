# FluxTV

![Python](https://img.shields.io/badge/Python-3.11+-blue)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?logo=fastapi)
![SQLite](https://img.shields.io/badge/SQLite-Self--Hosted-003B57?logo=sqlite)
![License](https://img.shields.io/badge/License-GPLv3-blue.svg)

> **A modern, self-hosted IPTV manager built for channels that provide their own iframe embed players. Automates EPG and logos, supports JSON/CSV imports, and runs beautifully on Firestick. Ships with a completely empty database—no pre-loaded data.**

FluxTV provides a sleek, card-based interface to manage, organize, and play live TV streams. Users simply add the `embed_url` of a channel (provided by the channel's website), and FluxTV handles the rest—mapping EPG data, fetching logos, and providing a custom fullscreen player.

---

## ✨ Features

- 🏠 Sleek card-based UI with horizontal scrolling rows
- 📺 **Direct iframe embed URLs only** (No M3U or scraping)
- 🔒 **Empty by default** (No pre-loaded channels, EPG, or logos)
- 📡 Full channel and group management (CRUD, Favorites, Enable/Disable)
- 🗓️ **Automatic EPG mapping** and manual search
- 🖼️ **Automatic logo matching** + direct URL assignment
- 📥 Bulk channel import via **JSON or CSV**
- 💾 Full Database Backup & Restore
- 🖥️ Firestick / TV Bro fullscreen & remote back button support
- 🐳 Single-container Docker deployment

---

## 📸 Screenshots

| Home | Live TV | EPG Guide |
| :--- | :--- | :--- |
| ![Home](https://github.com/VirtueCore/fluxtv/blob/50a675d95dff009d52fc8d0ac8d43006ff0c6489/fluxtv-home.png) | ![Live TV](https://github.com/VirtueCore/fluxtv/blob/50a675d95dff009d52fc8d0ac8d43006ff0c6489/fluxtv-livetv.png) | ![Guide](https://github.com/VirtueCore/fluxtv/blob/50a675d95dff009d52fc8d0ac8d43006ff0c6489/fluxtv-guide.png) |

| Manage Channels | Logo Mapping | Backup |
| :--- | :--- | :--- |
| ![Manage](https://github.com/VirtueCore/fluxtv/blob/50a675d95dff009d52fc8d0ac8d43006ff0c6489/fluxtv-manage.png) | ![Logos](https://github.com/VirtueCore/fluxtv/blob/50a675d95dff009d52fc8d0ac8d43006ff0c6489/fluxtv-logos.png) | ![Backup](https://github.com/VirtueCore/fluxtv/blob/50a675d95dff009d52fc8d0ac8d43006ff0c6489/fluxtv-backup.png) |

---

## 🚀 Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/FluxTV.git
cd FluxTV
```

### 2. (Optional) Create an IPv4 BuildKit builder

```bash
docker buildx create --name ipv4 --driver docker-container --use
```

### 3. Build and start the container

```bash
docker compose up -d --build
```

The app will be available at: **http://localhost:8888**

### 4. View logs

```bash
docker compose logs -f
```

### 5. Stop the container

```bash
docker compose down
```

---

## ⚙️ Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `HOST` | `0.0.0.0` | Bind address (inside container) |
| `PORT` | `8888` | Port to listen on (inside container) |

---

## 🧭 Usage

### ⚠️ Important Note:
**FluxTV ships with a completely empty database.** It provides no channels, EPG data, or logos out of the box. You must provide your own content.

1. Add your channels via the **Manage** panel.
2. Provide the `embed_url` (the iframe URL from the channel's website).
3. Configure EPG sources (XMLTV) and let FluxTV auto-map them.
4. Configure Logo sources (GitHub or local) and let FluxTV auto-match them.
5. Browse, search, and play your channels.

---

## ❓ FAQ

### Does FluxTV come with any pre-loaded channels, EPG, or logos?
**No.** FluxTV ships with a completely empty database. You must add your own channels via the Manage panel, import them via JSON/CSV, and configure your own EPG and Logo sources.

### Does FluxTV support M3U playlists?
**No.** FluxTV is strictly for channels that provide their own iframe embed players. Users must provide the `embed_url` for each channel.

### Does FluxTV scrape or use third-party content APIs to find streams?
**No.** It does not scrape content or use third-party APIs to find streams. It only manages and plays the embed URLs that you provide.

### Does this work on Firestick?
Yes. The UI and player are heavily optimized for the Amazon Firestick and TV Bro browser (including fullscreen scaling and back button handling).

---

## 🐳 Docker Commands

| Command | Description |
| :--- | :--- |
| `docker compose build` | Build the image |
| `docker compose up -d` | Start in detached mode |
| `docker compose logs -f` | Follow logs |
| `docker compose restart` | Restart the service |
| `docker compose down` | Stop and remove the container |

---

## 🛠️ Manual Run (without Docker)

```bash
cd fluxtv
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8888
```

---

## 📁 Project Structure

```text
fluxtv/
├── app/
│   ├── api/
│   │   ├── backup.py
│   │   ├── channels.py
│   │   ├── epg.py
│   │   ├── groups.py
│   │   ├── health.py
│   │   ├── import_export.py
│   │   ├── logos.py
│   │   └── settings.py
│   ├── services/
│   │   ├── epg_service.py
│   │   ├── logo_service.py
│   │   └── matching_service.py
│   ├── main.py
│   ├── models.py
│   ├── schemas.py
│   └── database.py
├── data/
│   ├── fluxtv.db
│   └── logos/
├── static/
│   ├── css/
│   │   └── main.css
│   └── js/
│       ├── app.js
│       ├── player.js
│       ├── manage.js
│       └── ...
├── templates/
│   └── index.html
├── docker-compose.yml
├── Dockerfile
├── requirements.txt
└── README.md
```

---

## 🏗️ Architecture

```text
         Browser (Firestick / TV Bro)
            │
            ▼
   +-------------------+
   |      FluxTV       |
   |   (FastAPI:8888)  |
   +-------------------+
      │           │
      │           ▼
      │        SQLite DB
      │        (Empty upon install)
      │
      ▼
   User-Provided Iframe Embed URLs
   (No M3U, No Scraping, No Content)
      │
      ▼
   User-Provided EPG XML Sources
   (github_dir, local_file, remote JSON)
```

---

## 🧠 How It Works

1. User installs FluxTV. The database is completely empty.
2. User adds channels and groups via the Manage panel, providing `embed_url` for each channel.
3. User configures EPG sources and automatically maps them to channels.
4. User configures Logo sources and automatically matches them to channels.
5. The frontend fetches channel and guide data from the FastAPI backend.
6. User clicks play; the player loads the external embed URL.
7. Fullscreen is handled via native browser APIs, with custom logic for Firestick compatibility.

---

## ⚡ Performance Features

- Async FastAPI with SQLAlchemy
- Automatic EPG and Logo matching services
- Bulk JSON/CSV import
- Persistent SQLite storage
- Custom CSS/JS (no heavy frontend frameworks)
- Lazy loading of logo images

---

## 🗺️ Roadmap

- [ ] Multiple stream sources per channel
- [ ] Server-side watch history
- [ ] Automatic channel scanning
- [ ] Docker image publishing

---

## ⚠️ Disclaimer

This project is intended for **self-hosting, development, and educational purposes**. FluxTV acts solely as a management and playback interface. It does **not** host, scrape, or provide any content, channels, EPG data, or logos. All data is strictly user-provided. Users are responsible for ensuring their use complies with applicable laws and regulations.

---

## 📜 License

This project is licensed under the **GNU General Public License v3.0 (GPLv3)**.  
See [LICENSE](LICENSE) for details.

---

## 🤝 Contributing

Pull requests, bug reports, and feature requests are welcome.  
If you encounter an issue:

1. Open an issue.
2. Include logs.
3. Describe how to reproduce it.
4. Include your Docker version and operating system.
