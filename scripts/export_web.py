"""导出网页版所需数据：腿部渲染网格、丝袜仿真网格、人体有符号距离场(SDF)。
用法: blender -b cloth_sim.blend -P scripts/export_web.py   （不会保存 .blend）
坐标转换为 three.js 的 Y 朝上： (x, y, z) -> (x, z, -y)
"""
import bpy, bmesh, os, json, time
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "web", "data")
os.makedirs(OUT, exist_ok=True)
scene = bpy.context.scene
scene.frame_set(1)
body = bpy.data.objects["Body"]


def eval_mesh(ob):
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    return bpy.data.meshes.new_from_object(ob.evaluated_get(dg))


def write_mesh(name, me, normals=True):
    me.calc_loop_triangles()
    n = len(me.vertices)
    co = np.empty(n * 3, np.float32); me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3); co = np.stack([co[:, 0], co[:, 2], -co[:, 1]], 1)
    tri = np.empty(len(me.loop_triangles) * 3, np.uint32); me.loop_triangles.foreach_get("vertices", tri)
    co.astype(np.float32).tofile(os.path.join(OUT, name + "_pos.bin"))
    tri.tofile(os.path.join(OUT, name + "_idx.bin"))
    if normals:
        no = np.empty(n * 3, np.float32); me.vertex_normals.foreach_get("vector", no)
        no = no.reshape(-1, 3); no = np.stack([no[:, 0], no[:, 2], -no[:, 1]], 1)
        no.astype(np.float32).tofile(os.path.join(OUT, name + "_nrm.bin"))
    return {"verts": n, "tris": len(me.loop_triangles)}


meta = {}

# ---- SDF（用高精度人体）
hi = body.data
verts = [v.co.copy() for v in hi.vertices]
polys = [tuple(p.vertices) for p in hi.polygons]
bvh = BVHTree.FromPolygons(verts, polys)
H = 0.006
lo = np.array([-0.27, -0.012, -0.24]); hi_b = np.array([0.27, 1.07, 0.24])     # three 坐标
dims = np.ceil((hi_b - lo) / H).astype(int) + 1
t = time.time()
data = np.empty((dims[2], dims[1], dims[0]), np.float32)
for k in range(dims[2]):
    z3 = lo[2] + k * H
    for j in range(dims[1]):
        y3 = lo[1] + j * H
        for i in range(dims[0]):
            p = Vector((lo[0] + i * H, -z3, y3))          # 转回 Blender 坐标
            loc, nrm, idx, dist = bvh.find_nearest(p)
            data[k, j, i] = -dist if (p - loc).dot(nrm) < 0 else dist
print("SDF", dims, "%.1fs" % (time.time() - t))
RANGE = 0.3
(np.clip(data / RANGE, -1, 1) * 32767).astype(np.int16).tofile(os.path.join(OUT, "sdf.bin"))
meta["sdf"] = {"dims": [int(d) for d in dims], "origin": [float(v) for v in lo], "cell": H, "range": RANGE}

# ---- 渲染用人体（减面）
tmp = bpy.data.objects.new("tmpBody", hi.copy()); scene.collection.objects.link(tmp)
d = tmp.modifiers.new("Dec", "DECIMATE"); d.ratio = 0.16
me = eval_mesh(tmp)
meta["body"] = write_mesh("body", me)

# ---- 丝袜仿真网格（较粗，三角化）
st = bpy.data.objects.new("tmpStock", hi.copy()); scene.collection.objects.link(st)
r = st.modifiers.new("Remesh", "REMESH"); r.mode = 'VOXEL'; r.voxel_size = 0.0105
s = st.modifiers.new("Smooth", "SMOOTH"); s.factor = 0.5; s.iterations = 8
w = st.modifiers.new("Wrap", "SHRINKWRAP"); w.target = body
w.wrap_method = 'NEAREST_SURFACEPOINT'; w.wrap_mode = 'ABOVE_SURFACE'; w.offset = 0.0022
me = eval_mesh(st)
bm = bmesh.new(); bm.from_mesh(me)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z > 0.905], context='VERTS')
bmesh.ops.triangulate(bm, faces=bm.faces)
bm.to_mesh(me); bm.free()
meta["stocking"] = write_mesh("stocking", me, normals=False)

json.dump(meta, open(os.path.join(OUT, "meta.json"), "w"), indent=1)
print("EXPORTED", meta)
