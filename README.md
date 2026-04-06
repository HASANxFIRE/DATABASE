# Public Database & Storage Server

## 🚀 Super Fast Public Database + File Storage System

### Features
- ✅ **Complete Database API** - Store/retrieve any JSON data
- ✅ **File Storage System** - Upload/download any files
- ✅ **150+ Concurrent Requests** - Optimized for high performance
- ✅ **Web Interface** - User-friendly dashboard
- ✅ **Public Access** - No authentication required
- ✅ **Batch Operations** - Multiple operations at once
- ✅ **Search Functionality** - Search through your data
- ✅ **Automatic File Metadata** - Track all file information

### API Endpoints

#### Database API (`/api`)
- `GET /api/data` - Get all data
- `GET /api/data/:key` - Get specific key
- `POST /api/data/:key` - Set/update key
- `DELETE /api/data/:key` - Delete key
- `POST /api/batch` - Batch operations
- `GET /api/search/:query` - Search data
- `GET /api/stats` - Server statistics

#### Storage API (`/storage`)
- `POST /storage/upload` - Upload single file
- `POST /storage/upload-multiple` - Upload multiple files
- `GET /storage/files` - List all files
- `GET /storage/files/:id/info` - Get file info
- `GET /storage/download/:id` - Download file
- `DELETE /storage/files/:id` - Delete file
- `GET /storage/files/:filename` - Access file directly

### Deployment on Render.com

1. **Create GitHub Repository**
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/HASANxFIRE/DATABASE.git
git push -u origin main
