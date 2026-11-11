# 布料模拟：薄丝袜与百褶裙

测试布料模拟效果的小项目，包含两个版本：

- **网页交互版**（`web/`）：浏览器里实时解算，可以用鼠标直接拉扯丝袜、拨动裙子。
- **Blender 离线版**（`scripts/`）：用 Blender 布料解算 + Cycles 渲染出的成片 `布料模拟_丝袜与裙子.mp4`。

## 网页交互版

双击 `启动网页版.bat`（需要本机装有 Python），或手动运行：

```bash
python -m http.server 8123 --directory web
```

然后打开 <http://localhost:8123/>。

- 左键按住丝袜或裙子拖拽；左键拖空白处或右键旋转视角；滚轮缩放。
- 面板可调丝袜颜色、厚度、弹性、风力，可显示线框，“扭一下”让身体扭动甩裙。

实现要点（`web/main.js`）：

- 丝袜：XPBD 弹性薄膜，带应变硬化；与腿的碰撞用预计算的有符号距离场；用“摩擦锚定”弹簧模拟丝袜贴在腿上，抓取点周围才是自由的。
- 透肤材质：覆盖率模型 `alpha = 1 - (1 - c)^(1/cosθ)`，`c` 随布料拉伸面积变小，所以拉开的地方更透、边缘更实。
- 裙子：XPBD 布料，横向抗弯约束保持褶子，风力和空气阻力沿布面法线作用。

## Blender 离线版

需要 Blender 5.0。按顺序运行：

```bash
blender -b --factory-startup -P scripts/build_scene.py
```

```bash
blender -b cloth_sim.blend -P scripts/bake.py
```

```bash
blender -b cloth_sim.blend -P scripts/render.py -- out/final 1 300 1 96 100
```

`scripts/export_web.py` 从 `cloth_sim.blend` 导出网页版用的腿部网格、丝袜网格和距离场到 `web/data/`。

## 已知不足

- 腿是程序生成的人台，脚部比较粗糙。
- 网页版丝袜只和腿碰撞，裙子没有自碰撞；拉得很远时帐篷边缘能看出棱角。
- Blender 版拉扯时大腿正面有一道轻微折痕。

## 第三方

`web/vendor/` 内为 [three.js](https://threejs.org/) r160（MIT 许可）。
