# 扩展图标

扩展需要三种尺寸的图标：

## 要求

| 尺寸 | 文件名 | 用途 |
|-----|--------|------|
| 16x16 | `icon-16.png` | 浏览器工具栏 |
| 48x48 | `icon-48.png` | 扩展管理页面 |
| 128x128 | `icon-128.png` | Chrome Web Store |

## 生成方法

### 方案1：在线工具
使用 [Favicon Generator](https://www.favicon-generator.org/) 或类似工具生成

### 方案2：设计软件
- Adobe Illustrator
- Figma
- Canva

### 方案3：使用默认图标（测试用）

为了快速测试，可以临时使用文本logo（ImageMagick命令）：

```bash
# 生成16x16
convert -size 16x16 xc:white -pointsize 8 -draw "text 1,10 'M'" icon-16.png

# 生成48x48
convert -size 48x48 xc:white -pointsize 24 -draw "text 8,32 'M'" icon-48.png

# 生成128x128
convert -size 128x128 xc:white -pointsize 64 -draw "text 20,90 'M'" icon-128.png
```

## 图标设计语言

建议参考：
- Material Design Icons
- Feather Icons
- Simple Minimalist Icons

由于是"词汇解析"工具，图标可选择：
- 📚 书籍
- 💡 灯泡（解析/理解）
- 🔍 放大镜（搜索）
- 🎯 目标（定位词汇）

---

将 PNG 文件放在本目录，后续可上传到 Chrome Web Store。
