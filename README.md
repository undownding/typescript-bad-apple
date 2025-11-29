# typescript-bad-apple

使用 [Sixel](https://en.wikipedia.org/wiki/Sixel) 图形技术在终端上播放 Bad Apple!! 的 TypeScript 实现。

## Requirements
* Typescript >= 5
* Node.js >= 18
* 支持 Sixel 的 Terminal （如 Windows Terminal 1.22 后的版本）

## Installation

```bash
npm install
npm run build
node dist/index.js
```

## 技术细节

将视频使用灰度图滤镜，对比度拉高1000，然后二值化后拆解序列帧：

```bash
ffmpeg -i badapple1080.mp4 \
-vf "format=gray,eq=contrast=1000" \
-pix_fmt monob ./frames/output_%04d.png
```

提取视频中的 audio 轨：

```bash
ffmpeg -i badapple1080.mp4 -vn -acodec copy output.aac
```

在代码中使用 [audic](https://www.npmjs.com/package/audic) 播放音频，并开始渲染动画。

渲染完每一帧后，根据已播放的时间计算出预期帧数，对比当前已播放帧数的差异，动态计算 sleep 时间，从而尽可能保证音画同步。