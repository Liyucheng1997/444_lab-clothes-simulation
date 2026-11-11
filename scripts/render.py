"""渲染。用法: blender -b cloth_sim.blend -P scripts/render.py -- 输出目录 起始帧 结束帧 [步长] [采样] [分辨率百分比]"""
import bpy, sys, os, time

a = sys.argv[sys.argv.index("--") + 1:]
out, f0, f1 = a[0], int(a[1]), int(a[2])
step = int(a[3]) if len(a) > 3 else 1
scene = bpy.context.scene
if len(a) > 4:
    scene.cycles.samples = int(a[4])
if len(a) > 5:
    scene.render.resolution_percentage = int(a[5])

prefs = bpy.context.preferences.addons["cycles"].preferences
for dev_type in ("OPTIX", "CUDA"):
    try:
        prefs.compute_device_type = dev_type
        prefs.get_devices()
        devs = [d for d in prefs.devices if d.type == dev_type]
        if devs:
            for d in prefs.devices:
                d.use = d.type == dev_type
            print("GPU:", dev_type, [d.name for d in devs])
            break
    except Exception as e:
        print("no", dev_type, e)
scene.cycles.device = 'GPU'

os.makedirs(out, exist_ok=True)
for f in range(f0, f1 + 1, step):
    path = os.path.join(out, "f_%04d.png" % f)
    if os.path.exists(path):
        continue
    t = time.time()
    scene.frame_set(f)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("FRAME %d %.1fs" % (f, time.time() - t), flush=True)
