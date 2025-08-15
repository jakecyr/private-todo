# Private Todo

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue.svg)](https://github.com/jakecyr/private-todo)
[![Node.js](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen.svg)](https://nodejs.org/)
[![Electron](https://img.shields.io/badge/Electron-25.0.0+-green.svg)](https://www.electronjs.org/)

A secure, privacy-focused desktop task management application built with Electron. Your tasks are encrypted locally and never leave your device.

## 🔒 Security Features

- **Local Encryption**: All data is encrypted using AES-256-GCM with your passcode
- **Biometric Authentication**: Optional Touch ID/Face ID support on supported devices
- **Secure Key Storage**: Encryption keys are stored in your system's secure keychain
- **No Cloud Sync**: Your data stays on your device - no external servers involved
- **Open Source**: Full transparency - review the code to verify security claims

## ✨ Features

- **Simple Task Management**: Create, edit, and organize tasks with ease
- **Project Organization**: Group tasks into projects for better organization
- **Smart Views**: Today, Week, and All views to focus on what matters
- **Priority System**: Mark tasks with P1 (high), P2 (medium), or P3 (low) priority
- **Tagging**: Add custom tags to categorize and filter tasks
- **Due Dates**: Set due dates for tasks with date picker support
- **Search**: Find tasks quickly with real-time search
- **Backup & Restore**: Export and import encrypted backups
- **Cross-Platform**: Works on macOS, Windows, and Linux

## 🚀 Getting Started

### Prerequisites

- Node.js 16+ and npm
- macOS 10.14+ (for Touch ID support)
- Windows 10+ (for Windows Hello support)
- Linux (biometric support varies by distribution)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/jakecyr/private-todo.git
   cd private-todo
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the application**
   ```bash
   npm start
   ```

4. **Development mode** (with hot reload)
   ```bash
   npm run dev
   ```

### First Run

On first launch, you'll be prompted to:
1. **Enable Encryption** (recommended): Create a secure passcode
2. **Set up Biometrics** (optional): Enable Touch ID/Face ID for quick access
3. **Create Your First Task**: Start organizing your life!

## 📱 Usage

### Creating Tasks
- **Quick Add**: Type in the main input field and press Enter
- **Detailed Tasks**: Use the option buttons below the input to set:
  - 📅 Due date
  - ⚡ Priority level
  - 🏷️ Tags
  - 📁 Project assignment

### Navigation
- **Today**: View tasks due today or overdue
- **Week**: See your week ahead with daily task creation
- **All**: Browse all tasks across all projects
- **Projects**: Organize tasks by project

### Security
- **Lock**: Click the lock icon to secure your data
- **Unlock**: Use your passcode or biometric authentication
- **Backup**: Export encrypted backups for safekeeping

## 🛠️ Development

### Project Structure
```
src/
├── main.js          # Main Electron process
├── preload.cjs      # Preload script for secure IPC
└── renderer/
    ├── index.html   # Main UI
    ├── renderer.js  # Renderer process logic
    └── styles.css   # Application styling
```

### Key Technologies
- **Electron**: Cross-platform desktop app framework
- **Node.js**: Backend runtime and file system operations
- **Vanilla JavaScript**: No framework dependencies
- **CSS Grid/Flexbox**: Modern layout system
- **Web Crypto API**: Secure encryption operations

### External Dependencies
- [![keytar](https://img.shields.io/badge/keytar-7.9.0+-blue.svg)](https://github.com/atom/node-keytar) - Secure keychain storage
- [![node:crypto](https://img.shields.io/badge/node:crypto-16.0.0+-green.svg)](https://nodejs.org/api/crypto.html) - Cryptographic operations
- [![fs](https://img.shields.io/badge/fs-16.0.0+-orange.svg)](https://nodejs.org/api/fs.html) - File system operations

### Development Commands
```bash
# Start development server
npm run dev

# Build for production
npm run build

# Package for distribution
npm run package

# Run tests
npm test

# Lint code
npm run lint
```

## 🔧 Configuration

### Environment Variables
- `NODE_ENV`: Set to `development` for debug mode
- `ELECTRON_IS_DEV`: Enable development features

### Settings
The app stores settings in `~/.config/private-todo/settings.json`:
- Encryption preferences
- Biometric authentication settings
- UI preferences

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

[![GitHub issues](https://img.shields.io/github/issues/jakecyr/private-todo)](https://github.com/jakecyr/private-todo/issues)
[![GitHub pull requests](https://img.shields.io/github/issues-pr/jakecyr/private-todo)](https://github.com/jakecyr/private-todo/pulls)
[![GitHub contributors](https://img.shields.io/github/contributors/jakecyr/private-todo)](https://github.com/jakecyr/private-todo/graphs/contributors)
[![GitHub stars](https://img.shields.io/github/stars/jakecyr/private-todo)](https://github.com/jakecyr/private-todo/stargazers)

### Quick Start for Contributors
1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Test thoroughly
5. Submit a pull request

### Areas We'd Love Help With
- 🧪 Testing and test coverage
- 🌍 Internationalization (i18n)
- 🎨 UI/UX improvements
- 🔒 Security enhancements
- 📱 Mobile companion app
- 🔌 Plugin system
- 📊 Analytics and insights

## 🐛 Troubleshooting

### Common Issues

**"Touch ID succeeded, but no decryption key found"**
- This usually means the keychain entry was deleted or corrupted
- Click "OK" to use your passcode - the app will automatically re-seed the keychain
- Future biometric unlocks should work normally

**App won't start**
- Check that Node.js 16+ is installed
- Verify all dependencies are installed: `npm install`
- Check console for error messages

**Encryption issues**
- Ensure you remember your passcode
- Use the backup/restore feature if needed
- Check that your system keychain is accessible

### Getting Help
- 📖 Check this README and [CONTRIBUTING.md](CONTRIBUTING.md)
- 🐛 Search existing [Issues](https://github.com/jakecyr/private-todo/issues)
- 💬 Start a [Discussion](https://github.com/jakecyr/private-todo/discussions)
- 📧 Contact the maintainers

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Electron Team**: For the amazing desktop app framework
- **Node.js Community**: For the robust runtime environment
- **Security Researchers**: For encryption best practices
- **Open Source Contributors**: For making this project possible

## 📈 Roadmap

- [ ] **v1.1**: Dark mode and themes
- [ ] **v1.2**: Recurring tasks and reminders
- [ ] **v1.3**: Task templates and bulk operations
- [ ] **v2.0**: Sync between devices (optional, encrypted)
- [ ] **v2.1**: Mobile companion app
- [ ] **v3.0**: Plugin ecosystem

## 🔗 Links & Resources

- 🌐 **Website**: [Coming Soon]
- 📖 **Documentation**: [This README](README.md) | [Contributing Guide](CONTRIBUTING.md)
- 🐛 **Bug Reports**: [GitHub Issues](https://github.com/jakecyr/private-todo/issues)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/jakecyr/private-todo/discussions)
- 📦 **Releases**: [GitHub Releases](https://github.com/jakecyr/private-todo/releases)
- 🔒 **Security**: [Security Policy](SECURITY.md) | [Report Vulnerability](mailto:security@example.com)

## 🌟 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=jakecyr/private-todo&type=Date)](https://star-history.com/#jakecyr/private-todo&Date)

---

**Made with ❤️ and 🔒 by the Private Todo community**

*Your privacy is our priority. This app is designed to keep your data secure and local.*
