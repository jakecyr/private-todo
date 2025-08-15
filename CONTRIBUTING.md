# Contributing to Private Todo

Thank you for your interest in contributing to Private Todo! This document provides guidelines and information for contributors.

## 🤝 How to Contribute

We welcome contributions from developers of all skill levels. Whether you're fixing a bug, adding a feature, improving documentation, or suggesting ideas, your help is appreciated!

### Types of Contributions

- 🐛 **Bug Reports**: Help us identify and fix issues
- ✨ **Feature Requests**: Suggest new functionality
- 🔧 **Code Contributions**: Submit pull requests with improvements
- 📚 **Documentation**: Improve docs, add examples, fix typos
- 🧪 **Testing**: Write tests, report bugs, test on different platforms
- 🎨 **Design**: Suggest UI/UX improvements, create mockups
- 🌍 **Localization**: Help translate the app to other languages
- 🔒 **Security**: Report security vulnerabilities (see Security section)

## 🚀 Getting Started

### Prerequisites

- **Node.js 16+** and npm
- **Git** for version control
- **Code editor** (VS Code recommended)
- **Basic knowledge** of JavaScript, HTML, CSS, and Electron

### Development Setup

1. **Fork the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/private-todo.git
   cd private-todo
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start development mode**
   ```bash
   npm run dev
   ```

4. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

## 📋 Contribution Guidelines

### Code Standards

#### JavaScript
- Use **ES6+** features (arrow functions, destructuring, etc.)
- Follow **consistent naming conventions**:
  - `camelCase` for variables and functions
  - `PascalCase` for classes and constructors
  - `UPPER_SNAKE_CASE` for constants
- **No framework dependencies** - keep it vanilla
- Use **async/await** instead of raw promises when possible
- Add **JSDoc comments** for complex functions

#### CSS
- Use **CSS custom properties** (variables) for theming
- Follow **BEM methodology** for class naming
- Use **Flexbox and Grid** for layouts
- Ensure **responsive design** for different screen sizes
- **No external CSS frameworks** - keep it lightweight

#### HTML
- Use **semantic HTML5** elements
- Ensure **accessibility** (ARIA labels, keyboard navigation)
- Keep **structure clean** and well-organized

### Security Guidelines

⚠️ **Critical**: This app handles sensitive user data. Security is paramount.

#### Encryption
- **Never log sensitive data** (passcodes, encryption keys, user data)
- Use **cryptographically secure** random number generation
- **Validate all inputs** to prevent injection attacks
- **Sanitize data** before storing or displaying

#### IPC Communication
- **Validate all IPC messages** in the main process
- Use **preload scripts** to expose only necessary APIs
- **Never expose internal functions** to the renderer process
- **Sanitize file paths** to prevent directory traversal

#### File Operations
- **Validate file paths** before reading/writing
- Use **atomic write operations** for data integrity
- **Handle file permissions** gracefully
- **Backup before destructive operations**

### Testing Requirements

- **Test on multiple platforms** (macOS, Windows, Linux)
- **Verify encryption/decryption** works correctly
- **Test biometric authentication** on supported devices
- **Ensure data persistence** across app restarts
- **Test error handling** for edge cases

## 🔄 Contribution Workflow

### 1. Issue Discussion

Before submitting code:
- **Search existing issues** to avoid duplicates
- **Discuss your approach** in the issue comments
- **Get feedback** from maintainers on complex changes
- **Ensure the feature aligns** with project goals

### 2. Development

- **Keep changes focused** - one feature/fix per PR
- **Write clear commit messages**:
  ```
  feat: add dark mode toggle
  fix: resolve task edit not saving in week view
  docs: update installation instructions
  ```
- **Test thoroughly** before submitting
- **Update documentation** if needed

### 3. Pull Request

- **Use descriptive titles** that explain the change
- **Fill out the PR template** completely
- **Link related issues** using `Closes #123` or `Fixes #456`
- **Include screenshots** for UI changes
- **Add tests** for new functionality

### 4. Review Process

- **Address review comments** promptly
- **Request reviews** from maintainers
- **Be open to feedback** and suggestions
- **Update PR** based on review feedback

## 🏗️ Project Structure

```
private-todo/
├── src/
│   ├── main.js              # Main Electron process
│   ├── preload.cjs          # Preload script (IPC bridge)
│   └── renderer/            # Frontend code
│       ├── index.html       # Main UI structure
│       ├── renderer.js      # Frontend logic
│       └── styles.css       # Application styling
├── package.json             # Dependencies and scripts
├── README.md               # Project overview
└── CONTRIBUTING.md         # This file
```

### Key Files to Understand

- **`main.js`**: Backend logic, file operations, encryption
- **`preload.cjs`**: Secure API exposure to renderer
- **`renderer.js`**: UI logic, user interactions, data rendering
- **`styles.css`**: Visual design and responsive layout

## 🧪 Testing

### Manual Testing Checklist

- [ ] **App launches** without errors
- [ ] **Encryption setup** works correctly
- [ ] **Biometric authentication** functions (if available)
- [ ] **Task creation/editing** works in all views
- [ ] **Project management** functions properly
- [ ] **Search functionality** works as expected
- [ ] **Backup/restore** operations succeed
- [ ] **App locks/unlocks** correctly
- [ ] **Window controls** (minimize, maximize, close) work
- [ ] **Responsive design** on different window sizes

### Automated Testing

We're working on adding automated tests. For now, focus on:
- **Manual testing** on multiple platforms
- **Edge case testing** (empty data, corrupted files, etc.)
- **Performance testing** with large datasets
- **Security testing** (input validation, encryption)

## 🐛 Bug Reports

### Before Reporting

- **Search existing issues** for similar problems
- **Check the troubleshooting section** in README
- **Verify the issue** on the latest version
- **Test on different platforms** if possible

### Bug Report Template

```markdown
**Platform**: macOS 12.0 / Windows 11 / Ubuntu 20.04
**App Version**: [from package.json]
**Node.js Version**: [node --version]

**Description**
Clear description of what happened vs. what you expected.

**Steps to Reproduce**
1. Step 1
2. Step 2
3. Step 3

**Expected Behavior**
What should happen?

**Actual Behavior**
What actually happened?

**Screenshots**
If applicable, add screenshots.

**Console Logs**
Any error messages or console output.

**Additional Context**
Any other relevant information.
```

## ✨ Feature Requests

### Guidelines

- **Explain the problem** you're trying to solve
- **Describe your proposed solution**
- **Consider alternatives** and trade-offs
- **Think about security implications**
- **Consider cross-platform compatibility**

### Feature Request Template

```markdown
**Problem Statement**
What problem are you trying to solve?

**Proposed Solution**
Describe your proposed solution.

**Alternatives Considered**
What other approaches did you consider?

**Additional Context**
Any other relevant information.
```

## 🔒 Security Vulnerabilities

**Do NOT create public issues for security vulnerabilities.**

### Reporting Security Issues

1. **Email the maintainers** directly
2. **Provide detailed information** about the vulnerability
3. **Allow time** for assessment and fix
4. **Coordinate disclosure** with maintainers

### Security Best Practices

- **Never commit secrets** (API keys, passwords, etc.)
- **Use environment variables** for configuration
- **Validate all user inputs**
- **Follow the principle of least privilege**
- **Keep dependencies updated**

## 📚 Documentation

### What to Document

- **New features** and how to use them
- **Configuration options** and their effects
- **API changes** and migration guides
- **Troubleshooting steps** for common issues
- **Development setup** and contribution process

### Documentation Standards

- Use **clear, concise language**
- Include **examples** and code snippets
- **Update related docs** when making changes
- Use **consistent formatting** and structure
- **Test instructions** before documenting

## 🎯 Areas for Contribution

### High Priority
- 🧪 **Test coverage** and automated testing
- 🔒 **Security audit** and vulnerability scanning
- 📱 **Mobile companion app** development
- 🌍 **Internationalization** (i18n) support

### Medium Priority
- 🎨 **UI/UX improvements** and accessibility
- 📊 **Analytics dashboard** for task insights
- 🔌 **Plugin system** for extensibility
- 📅 **Calendar integration** and reminders

### Low Priority
- 🎨 **Themes and customization** options
- 📱 **Progressive Web App** (PWA) features
- 🔄 **Sync between devices** (optional, encrypted)
- 📈 **Performance optimizations**

## 🏆 Recognition

### Contributors

- **Code contributors** are listed in the README
- **Security researchers** are acknowledged for responsible disclosure
- **Documentation contributors** are credited for their work
- **Community members** are recognized for their support

### Getting Help

- **GitHub Discussions**: For questions and community support
- **GitHub Issues**: For bug reports and feature requests
- **Pull Request Reviews**: For code feedback and guidance
- **Maintainer Contact**: For security issues or private matters

## 📄 License

By contributing to Private Todo, you agree that your contributions will be licensed under the same license as the project (MIT License).

## 🙏 Thank You

Thank you for contributing to Private Todo! Your help makes this project better for everyone who values privacy and security in their task management.

---

**Questions?** Open a GitHub Discussion or contact the maintainers directly.

**Ready to contribute?** Start by checking the [Issues](https://github.com/yourusername/private-todo/issues) page for open tasks!
