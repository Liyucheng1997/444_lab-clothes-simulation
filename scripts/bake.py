"""烘焙布料缓存。用法: blender -b cloth_sim.blend -P scripts/bake.py -- [结束帧]"""
import bpy, sys, time

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
scene = bpy.context.scene
end = int(argv[0]) if argv else scene.frame_end
for ob in scene.objects:
    for m in ob.modifiers:
        if m.type == 'CLOTH':
            m.point_cache.frame_end = end
            m.point_cache.use_disk_cache = True
t = time.time()
bpy.ops.ptcache.free_bake_all()
bpy.ops.ptcache.bake_all(bake=True)
print("BAKED to", end, "in %.1fs" % (time.time() - t))
bpy.ops.wm.save_mainfile()
