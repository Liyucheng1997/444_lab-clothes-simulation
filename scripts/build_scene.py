"""搭建布料模拟场景：人台腿部 + 薄丝袜（布料）+ 百褶裙（布料）。
用法: blender -b --factory-startup -P scripts/build_scene.py
输出: cloth_sim.blend（未烘焙）
"""
import bpy, bmesh, math, os
from mathutils import Vector, Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLEND = os.path.join(ROOT, "cloth_sim.blend")
FPS = 24
F_END = 300
CUT = 150            # 镜头切换帧：之前特写拉扯丝袜，之后全景裙摆

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS
scene.frame_start, scene.frame_end = 1, F_END
col = scene.collection


def new_obj(name, me):
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    return ob


def bake_mods(ob):
    """把修改器结果固化为新网格"""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    ob.modifiers.clear()
    old = ob.data
    ob.data = me
    bpy.data.meshes.remove(old)
    return me


# ---------------------------------------------------------------- 人体基础形
def catmull(keys, z):
    """keys: 按 z 降序的 (z, ...) 列表，返回 z 处平滑插值"""
    ks = sorted(keys, key=lambda k: k[0])
    if z <= ks[0][0]:
        return ks[0][1:]
    if z >= ks[-1][0]:
        return ks[-1][1:]
    for i in range(len(ks) - 1):
        if ks[i][0] <= z <= ks[i + 1][0]:
            break
    p0 = ks[max(i - 1, 0)]; p1 = ks[i]; p2 = ks[i + 1]; p3 = ks[min(i + 2, len(ks) - 1)]
    t = (z - p1[0]) / (p2[0] - p1[0])
    out = []
    for a, b, c, d in zip(p0[1:], p1[1:], p2[1:], p3[1:]):
        out.append(0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t
                          + (-a + 3 * b - 3 * c + d) * t ** 3))
    return out


def loft(bm, keys, mirror=1.0, n=40, step=0.01):
    """沿 z 放样椭圆截面的封闭管 keys: (z, cx, cy, rx, ry)"""
    zs = sorted(k[0] for k in keys)
    z0, z1 = zs[0], zs[-1]
    cnt = int(round((z1 - z0) / step)) + 1
    rings = []
    for i in range(cnt):
        z = z0 + (z1 - z0) * i / (cnt - 1)
        cx, cy, rx, ry = catmull(keys, z)
        ring = [bm.verts.new((mirror * cx + rx * math.cos(2 * math.pi * j / n),
                              cy + ry * math.sin(2 * math.pi * j / n), z)) for j in range(n)]
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for j in range(n):
            bm.faces.new((a[j], a[(j + 1) % n], b[(j + 1) % n], b[j]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])


def ellipsoid(bm, c, r):
    m = Matrix.Translation(c) @ Matrix.Diagonal((r[0], r[1], r[2], 1.0))
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=20, radius=1.0, matrix=m)


# 正面朝 -Y。 (z, cx, cy, rx, ry)
LEG = [
    (0.86, 0.094, 0.004, 0.086, 0.092),
    (0.76, 0.092, 0.004, 0.084, 0.090),
    (0.66, 0.088, 0.003, 0.075, 0.081),
    (0.56, 0.082, 0.002, 0.063, 0.068),
    (0.49, 0.078, 0.002, 0.053, 0.057),
    (0.455, 0.076, 0.000, 0.050, 0.054),
    (0.41, 0.075, 0.004, 0.045, 0.048),
    (0.33, 0.076, 0.013, 0.051, 0.056),
    (0.24, 0.075, 0.011, 0.043, 0.046),
    (0.14, 0.073, 0.007, 0.032, 0.035),
    (0.08, 0.072, 0.007, 0.028, 0.032),
    (0.03, 0.072, 0.006, 0.030, 0.036),
]
PELVIS = [
    (1.04, 0.0, 0.0, 0.128, 0.088),
    (0.97, 0.0, 0.0, 0.140, 0.094),
    (0.88, 0.0, 0.005, 0.172, 0.108),
    (0.80, 0.0, 0.005, 0.165, 0.100),
    (0.765, 0.0, 0.005, 0.120, 0.085),
]


def body_primitives():
    bm = bmesh.new()
    for s in (1.0, -1.0):
        loft(bm, LEG, mirror=s)
        ellipsoid(bm, (s * 0.076, -0.040, 0.458), (0.024, 0.016, 0.030))     # 髌骨
        ellipsoid(bm, (s * 0.085, 0.050, 0.845), (0.085, 0.082, 0.085))      # 臀
        ellipsoid(bm, (s * 0.072, 0.014, 0.036), (0.031, 0.038, 0.036))      # 脚跟
        ellipsoid(bm, (s * 0.074, -0.060, 0.032), (0.036, 0.078, 0.031))     # 足弓
        ellipsoid(bm, (s * 0.077, -0.128, 0.022), (0.043, 0.050, 0.021))     # 脚掌
        ellipsoid(bm, (s * 0.046, 0.004, 0.075), (0.012, 0.016, 0.014))      # 内踝
        ellipsoid(bm, (s * 0.099, 0.012, 0.068), (0.011, 0.015, 0.013))      # 外踝
    loft(bm, PELVIS)
    for v in bm.verts:
        v.co.z = max(v.co.z, 0.0)
    me = bpy.data.meshes.new("prim")
    bm.to_mesh(me); bm.free()
    return me


def make_remeshed(name, voxel, smooth_iter):
    ob = new_obj(name, body_primitives())
    r = ob.modifiers.new("Remesh", "REMESH")
    r.mode = 'VOXEL'; r.voxel_size = voxel; r.adaptivity = 0.0
    s = ob.modifiers.new("Smooth", "SMOOTH")
    s.factor = 0.5; s.iterations = smooth_iter
    me = bake_mods(ob)
    me.shade_smooth()
    return ob


body = make_remeshed("Body", 0.0035, 24)
print("body verts", len(body.data.vertices))

# ---------------------------------------------------------------- 丝袜
stock = make_remeshed("Stocking", 0.0062, 14)
sw = stock.modifiers.new("Wrap", "SHRINKWRAP")
sw.target = body; sw.wrap_method = 'NEAREST_SURFACEPOINT'
sw.wrap_mode = 'ABOVE_SURFACE'; sw.offset = 0.0028
bake_mods(stock)
bm = bmesh.new(); bm.from_mesh(stock.data)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z > 0.905], context='VERTS')
bm.to_mesh(stock.data); bm.free()
stock.data.shade_smooth()
me = stock.data
print("stocking verts", len(me.vertices))

# 静止形状属性：用于按拉伸程度改变透明度、以及让针织纹理跟着布料走
a = me.attributes.new("rest_pos", 'FLOAT_VECTOR', 'POINT')
for i, v in enumerate(me.vertices):
    a.data[i].vector = v.co
a = me.attributes.new("rest_area", 'FLOAT', 'FACE')
for i, p in enumerate(me.polygons):
    a.data[i].value = max(p.area, 1e-9)

# 抓取点（丝袜上最近的顶点为中心，半径 r 内的顶点被“捏住”）
GRABS = [
    # 名称, 目标点, 半径, [(帧, 相对位移)]
    ("grab1", Vector((-0.175, -0.035, 0.600)), 0.011,
     [(20, (0, 0, 0)), (48, (-0.125, -0.075, 0.000)), (58, (-0.105, -0.085, 0.030)),
      (68, (-0.135, -0.060, -0.030)), (76, (-0.130, -0.065, -0.025)), (79, (0, 0, 0))]),
    ("grab2", Vector((0.150, -0.050, 0.560)), 0.011,
     [(92, (0, 0, 0)), (116, (0.120, -0.090, -0.020)), (126, (0.140, -0.060, 0.030)),
      (136, (0.110, -0.100, -0.010)), (142, (0.115, -0.095, -0.010)), (145, (0, 0, 0))]),
]
pin = stock.vertex_groups.new(name="pin")
pin.add([v.index for v in me.vertices if v.co.z > 0.888 or v.co.z < 0.004], 1.0, 'REPLACE')
bpy.context.view_layer.update()
grab_centres = []


def pin_weight(v):
    for g_ in v.groups:
        if g_.group == pin.index:
            return g_.weight
    return 0.0


for name, target, rad, keys in GRABS:
    centre = min(me.vertices, key=lambda v: (v.co - target).length).co.copy()
    idx = [v.index for v in me.vertices if (v.co - centre).length < rad]
    g = stock.vertex_groups.new(name=name)
    g.add(idx, 1.0, 'REPLACE'); pin.add(idx, 1.0, 'REPLACE')
    e = bpy.data.objects.new(name + "_handle", None)
    e.empty_display_size = 0.02; col.objects.link(e)
    e.parent = body
    for f, d in keys:
        e.location = centre + Vector(d)
        e.keyframe_insert("location", frame=f)
    scene.frame_set(1); bpy.context.view_layer.update()
    h = stock.modifiers.new(name, "HOOK")
    h.object = e; h.vertex_group = name; h.falloff_type = 'NONE'
    e.location = centre; bpy.context.view_layer.update()
    h.matrix_inverse = e.matrix_world.inverted() @ stock.matrix_world
    print(name, "verts", len(idx))
    grab_centres.append(centre)

# “摩擦锚定”：离抓取点远的布料由软弹簧/硬钉固定在腿上，只有抓取点周围一片是自由的
def smooth(a_, b_, x):
    t_ = min(max((x - a_) / (b_ - a_), 0.0), 1.0)
    return t_ * t_ * (3 - 2 * t_)

for v in me.vertices:
    w = 1.0
    for gc in grab_centres:
        d = v.co - gc
        dist = math.sqrt(d.x * d.x + d.y * d.y + (0.7 * d.z) ** 2)
        w = min(w, smooth(0.125, 0.19, dist))
    if w > 0.002 and w > pin_weight(v):
        pin.add([v.index], w, 'REPLACE')

# 人体碰撞
cm = body.modifiers.new("Collision", "COLLISION")
body.collision.thickness_outer = 0.001
body.collision.thickness_inner = 0.035
body.collision.cloth_friction = 12.0
body.collision.damping = 0.3

QUICK = bool(os.environ.get("QUICK"))      # 只调裙子时跳过丝袜解算
c = stock.modifiers.new("Cloth", "CLOTH")
c.show_viewport = c.show_render = not QUICK
s = c.settings
s.quality = 12
s.mass = 0.04
s.tension_stiffness = 7.0; s.compression_stiffness = 7.0
s.shear_stiffness = 2.0; s.bending_stiffness = 0.02
s.tension_damping = 6.0; s.compression_damping = 6.0
s.shear_damping = 4.0; s.bending_damping = 0.5
s.air_damping = 1.5
s.vertex_group_mass = "pin"; s.pin_stiffness = 1.0
s.shrink_min = 0.02                      # 预张力：丝袜紧绷在腿上
s.effector_weights.wind = 0.0
s.effector_weights.gravity = 0.0
cs = c.collision_settings
cs.use_collision = True; cs.distance_min = 0.001; cs.collision_quality = 4; cs.impulse_clamp = 0.0
cs.use_self_collision = False
c.point_cache.frame_start = 1; c.point_cache.frame_end = F_END
scm = stock.modifiers.new("Collision", "COLLISION")       # 让裙子能被拉起的丝袜顶起来
stock.collision.thickness_outer = 0.002; stock.collision.cloth_friction = 5.0

# 几何节点：stretch = 当前面积 / 静止面积
ng = bpy.data.node_groups.new("StretchAttr", "GeometryNodeTree")
ng.interface.new_socket("Geometry", in_out='INPUT', socket_type='NodeSocketGeometry')
ng.interface.new_socket("Geometry", in_out='OUTPUT', socket_type='NodeSocketGeometry')
N = ng.nodes
gi = N.new("NodeGroupInput"); go = N.new("NodeGroupOutput")
area = N.new("GeometryNodeInputMeshFaceArea")
rest = N.new("GeometryNodeInputNamedAttribute"); rest.data_type = 'FLOAT'
rest.inputs["Name"].default_value = "rest_area"
div = N.new("ShaderNodeMath"); div.operation = 'DIVIDE'
fod = N.new("GeometryNodeFieldOnDomain"); fod.domain = 'FACE'; fod.data_type = 'FLOAT'
blur = N.new("GeometryNodeBlurAttribute"); blur.data_type = 'FLOAT'
blur.inputs["Iterations"].default_value = 2
st = N.new("GeometryNodeStoreNamedAttribute"); st.data_type = 'FLOAT'; st.domain = 'POINT'
st.inputs["Name"].default_value = "stretch"
L = ng.links.new
L(area.outputs[0], div.inputs[0]); L(rest.outputs[0], div.inputs[1])
L(div.outputs[0], fod.inputs[0]); L(fod.outputs[0], blur.inputs[0])
L(gi.outputs[0], st.inputs["Geometry"]); L(blur.outputs[0], st.inputs["Value"])
L(st.outputs[0], go.inputs[0])
gm = stock.modifiers.new("Stretch", "NODES"); gm.node_group = ng
sub = stock.modifiers.new("Subdiv", "SUBSURF"); sub.levels = 1; sub.render_levels = 2
stock.parent = body

# ---------------------------------------------------------------- 百褶裙
NPLEAT, SEG, ROWS = 30, 6, 44
Z_TOP, LENGTH = 0.975, 0.285
bm = bmesh.new()
uvl = bm.loops.layers.uv.new("UVMap")
cols = NPLEAT * SEG
grid = []
for r in range(ROWS + 1):
    v = r / ROWS
    flare = v ** 0.62
    rx = 0.152 + (0.262 - 0.152) * flare
    ry = 0.106 + (0.225 - 0.106) * flare
    depth = 0.0015 + 0.019 * v ** 0.8
    row = []
    for k in range(cols):
        th = 2 * math.pi * k / cols
        saw = (k % SEG) / (SEG - 1)            # 刀褶：缓升后陡降
        cx, sy = math.cos(th), math.sin(th)
        nrm = Vector((cx / rx, sy / ry, 0)).normalized()
        p = Vector((rx * cx, ry * sy + 0.004, Z_TOP - LENGTH * v)) + nrm * depth * (saw - 0.5)
        row.append(bm.verts.new(p))
    grid.append(row)
for r in range(ROWS):
    for k in range(cols):
        k2 = (k + 1) % cols
        f = bm.faces.new((grid[r][k], grid[r][k2], grid[r + 1][k2], grid[r + 1][k]))
        uu = [(k / cols, r / ROWS), ((k + 1) / cols, r / ROWS),
              ((k + 1) / cols, (r + 1) / ROWS), (k / cols, (r + 1) / ROWS)]
        for lp, uv in zip(f.loops, uu):
            lp[uvl].uv = uv
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
sk_me = bpy.data.meshes.new("Skirt"); bm.to_mesh(sk_me); bm.free()
sk_me.shade_smooth()
skirt = new_obj("Skirt", sk_me)
g = skirt.vertex_groups.new(name="pin")
g.add([v.index for v in sk_me.vertices if v.co.z > Z_TOP - LENGTH * 1.5 / ROWS], 1.0, 'REPLACE')
skirt.parent = body
c = skirt.modifiers.new("Cloth", "CLOTH")
s = c.settings
s.quality = 10
s.mass = 0.02                       # 每顶点质量，整条裙子约 160 g
s.tension_stiffness = 5; s.compression_stiffness = 5
s.shear_stiffness = 1.5; s.bending_stiffness = 0.28
s.tension_damping = 3; s.compression_damping = 3; s.shear_damping = 2; s.bending_damping = 0.3
s.air_damping = 0.6
s.vertex_group_mass = "pin"
cs = c.collision_settings
cs.use_collision = True; cs.distance_min = 0.005; cs.collision_quality = 4
cs.use_self_collision = True; cs.self_distance_min = 0.0025; cs.self_friction = 5
c.point_cache.frame_start = 1; c.point_cache.frame_end = F_END
sub = skirt.modifiers.new("Subdiv", "SUBSURF"); sub.levels = 1; sub.render_levels = 1
so = skirt.modifiers.new("Solid", "SOLIDIFY"); so.thickness = 0.0009; so.offset = 0

# 腰带（装饰）
bm = bmesh.new()
n = 96
ra, rb = [], []
for j in range(n):
    th = 2 * math.pi * j / n
    ra.append(bm.verts.new((0.156 * math.cos(th), 0.110 * math.sin(th) + 0.004, Z_TOP + 0.012)))
    rb.append(bm.verts.new((0.158 * math.cos(th), 0.112 * math.sin(th) + 0.004, Z_TOP - 0.022)))
for j in range(n):
    bm.faces.new((ra[j], ra[(j + 1) % n], rb[(j + 1) % n], rb[j]))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
wb_me = bpy.data.meshes.new("Waistband"); bm.to_mesh(wb_me); bm.free(); wb_me.shade_smooth()
band = new_obj("Waistband", wb_me); band.parent = body
so = band.modifiers.new("Solid", "SOLIDIFY"); so.thickness = 0.004

# ---------------------------------------------------------------- 动画：扭胯 + 阵风
for f, deg, dx in [(CUT + 6, 0, 0), (CUT + 22, 42, 0.02), (CUT + 40, -42, -0.02),
                   (CUT + 58, 32, 0.015), (CUT + 74, -16, 0), (CUT + 88, 0, 0)]:
    body.rotation_euler = (0, 0, math.radians(deg)); body.location = (dx, 0, 0)
    body.keyframe_insert("rotation_euler", frame=f); body.keyframe_insert("location", frame=f)
body.rotation_euler = (0, 0, 0); body.location = (0, 0, 0)

bpy.ops.object.effector_add(type='WIND')
wind = bpy.context.view_layer.objects.active; wind.name = "Wind"
wind.location = (-1.2, -1.0, 0.5)
wind.rotation_euler = Vector((1.0, 0.75, 0.25)).to_track_quat('Z', 'Y').to_euler()
wind.field.type = 'WIND'; wind.field.noise = 2.0; wind.field.flow = 0.5
for f, st_ in [(1, 0), (CUT - 30, 0), (CUT - 5, 250), (CUT + 20, 80), (CUT + 90, 60),
               (CUT + 108, 5000), (CUT + 126, 1800), (F_END, 3500)]:
    wind.field.strength = st_
    wind.field.keyframe_insert("strength", frame=f)

# ---------------------------------------------------------------- 材质
def principled(mat):
    mat.use_nodes = True
    return mat.node_tree.nodes["Principled BSDF"]


# 皮肤
m = bpy.data.materials.new("Skin"); b = principled(m); nt = m.node_tree
geo = nt.nodes.new("ShaderNodeNewGeometry")
noise = nt.nodes.new("ShaderNodeTexNoise"); noise.inputs["Scale"].default_value = 9
noise.inputs["Detail"].default_value = 4
ramp = nt.nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].position = 0.3; ramp.color_ramp.elements[0].color = (0.86, 0.58, 0.52, 1)
ramp.color_ramp.elements[1].position = 0.75; ramp.color_ramp.elements[1].color = (0.90, 0.69, 0.62, 1)
nt.links.new(geo.outputs["Position"], noise.inputs["Vector"])
nt.links.new(noise.outputs[0], ramp.inputs[0])
nt.links.new(ramp.outputs[0], b.inputs["Base Color"])
b.inputs["Subsurface Weight"].default_value = 1.0
b.inputs["Subsurface Radius"].default_value = (1.0, 0.35, 0.18)
b.inputs["Subsurface Scale"].default_value = 0.012
b.inputs["Roughness"].default_value = 0.42
body.data.materials.append(m)

# 丝袜：覆盖率模型  alpha = 1-(1-c)^(1/cosθ),  c = c0 / stretch
m = bpy.data.materials.new("Sheer"); b = principled(m); nt = m.node_tree; nd = nt.nodes; L = nt.links.new
out = nd["Material Output"]


def math_node(op, a=None, bb=None, clamp=False):
    n_ = nd.new("ShaderNodeMath"); n_.operation = op; n_.use_clamp = clamp
    for i, x in enumerate((a, bb)):
        if x is None:
            continue
        if isinstance(x, (int, float)):
            n_.inputs[i].default_value = x
        else:
            L(x, n_.inputs[i])
    return n_.outputs[0]


at_s = nd.new("ShaderNodeAttribute"); at_s.attribute_name = "stretch"
at_p = nd.new("ShaderNodeAttribute"); at_p.attribute_name = "rest_pos"
geo = nd.new("ShaderNodeNewGeometry")
dot = nd.new("ShaderNodeVectorMath"); dot.operation = 'DOT_PRODUCT'
L(geo.outputs["Incoming"], dot.inputs[0]); L(geo.outputs["Normal"], dot.inputs[1])
cosv = math_node('MAXIMUM', math_node('ABSOLUTE', dot.outputs["Value"]), 0.10)
stretch = math_node('MAXIMUM', at_s.outputs["Fac"], 0.6)
# 针织横纹（跟随静止坐标，拉伸时纹路会被拉开）
sep = nd.new("ShaderNodeSeparateXYZ"); L(at_p.outputs["Vector"], sep.inputs[0])
rib = math_node('SINE', math_node('MULTIPLY', sep.outputs["Z"], 2 * math.pi / 0.0011))
knit = math_node('ADD', math_node('MULTIPLY', rib, 0.10), 1.0)
grain = nd.new("ShaderNodeTexNoise"); grain.inputs["Scale"].default_value = 2600
grain.inputs["Detail"].default_value = 1
L(at_p.outputs["Vector"], grain.inputs["Vector"])
cov = math_node('DIVIDE', 0.33, stretch)
cov = math_node('MULTIPLY', cov, knit)
cov = math_node('MULTIPLY', cov, math_node('ADD', math_node('MULTIPLY', grain.outputs["Fac"], 0.3), 0.85))
cov = math_node('MINIMUM', cov, 0.97)
alpha = math_node('SUBTRACT', 1.0, math_node('POWER', math_node('SUBTRACT', 1.0, cov),
                                             math_node('DIVIDE', 1.0, cosv)), clamp=True)
bump = nd.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.35
bump.inputs["Distance"].default_value = 0.0002
L(math_node('ADD', grain.outputs["Fac"], math_node('MULTIPLY', rib, 0.5)), bump.inputs["Height"])
b.inputs["Base Color"].default_value = (0.80, 0.79, 0.80, 1)
b.inputs["Roughness"].default_value = 0.38
b.inputs["Sheen Weight"].default_value = 0.8
b.inputs["Sheen Roughness"].default_value = 0.35
L(bump.outputs[0], b.inputs["Normal"])
tr = nd.new("ShaderNodeBsdfTransparent")
mix = nd.new("ShaderNodeMixShader")
L(alpha, mix.inputs[0]); L(tr.outputs[0], mix.inputs[1]); L(b.outputs[0], mix.inputs[2])
L(mix.outputs[0], out.inputs["Surface"])
stock.data.materials.append(m)

# 裙子：灰色格纹 + 下摆白条
m = bpy.data.materials.new("SkirtFabric"); b = principled(m); nt = m.node_tree; nd = nt.nodes; L = nt.links.new
tc = nd.new("ShaderNodeTexCoord"); sep = nd.new("ShaderNodeSeparateXYZ"); L(tc.outputs["UV"], sep.inputs[0])
ramp = nd.new("ShaderNodeValToRGB"); ramp.color_ramp.interpolation = 'CONSTANT'
els = ramp.color_ramp.elements
grey, white, dark = (0.20, 0.21, 0.23, 1), (0.78, 0.78, 0.78, 1), (0.07, 0.07, 0.08, 1)
els[0].position = 0.0; els[0].color = grey
els[1].position = 0.74; els[1].color = white
for p, c_ in [(0.79, grey), (0.83, dark), (0.855, grey), (0.89, white), (0.91, grey)]:
    e = els.new(p); e.color = c_
L(sep.outputs["Y"], ramp.inputs[0])
# 竖向细线
vline = math_node('GREATER_THAN', math_node('SINE', math_node('MULTIPLY', sep.outputs["X"], NPLEAT * 2 * math.pi)), 0.975)
mixc = nd.new("ShaderNodeMixRGB"); mixc.inputs[2].default_value = (0.6, 0.6, 0.62, 1)
L(vline, mixc.inputs[0]); L(ramp.outputs[0], mixc.inputs[1])
L(mixc.outputs[0], b.inputs["Base Color"])
weave = nd.new("ShaderNodeTexWave"); weave.inputs["Scale"].default_value = 900
weave.bands_direction = 'DIAGONAL'
L(tc.outputs["Object"], weave.inputs["Vector"])
bump = nd.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.25
bump.inputs["Distance"].default_value = 0.0003
L(weave.outputs["Fac"], bump.inputs["Height"]); L(bump.outputs[0], b.inputs["Normal"])
b.inputs["Roughness"].default_value = 0.75
b.inputs["Sheen Weight"].default_value = 0.4
skirt.data.materials.append(m); band.data.materials.append(m)

# 地面
bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=6)
fl_me = bpy.data.meshes.new("Floor"); bm.to_mesh(fl_me); bm.free()
floor = new_obj("Floor", fl_me); floor.location.z = -0.002
m = bpy.data.materials.new("FloorMat"); b = principled(m); nt = m.node_tree
nz = nt.nodes.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 14; nz.inputs["Detail"].default_value = 8
rp = nt.nodes.new("ShaderNodeValToRGB")
rp.color_ramp.elements[0].color = (0.16, 0.16, 0.17, 1); rp.color_ramp.elements[1].color = (0.42, 0.42, 0.43, 1)
nt.links.new(nz.outputs[0], rp.inputs[0]); nt.links.new(rp.outputs[0], b.inputs["Base Color"])
b.inputs["Roughness"].default_value = 0.8
floor.data.materials.append(m)

# ---------------------------------------------------------------- 灯光 / 相机
def aim(ob, target):
    ob.rotation_euler = (Vector(target) - ob.location).to_track_quat('-Z', 'Y').to_euler()


def area_light(name, loc, target, power, size, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, 'AREA'); ld.energy = power; ld.size = size; ld.color = color
    ob = bpy.data.objects.new(name, ld); col.objects.link(ob); ob.location = loc; aim(ob, target)
    return ob


area_light("Key", (0.5, -2.2, 1.7), (0, 0, 0.55), 42, 1.4, (1.0, 0.97, 0.94))
area_light("Fill", (-1.4, -1.6, 0.6), (0, 0, 0.5), 9, 1.5, (0.9, 0.94, 1.0))
area_light("RimL", (-1.5, 1.4, 1.1), (0, 0, 0.5), 45, 0.8)
area_light("RimR", (1.5, 1.4, 1.1), (0, 0, 0.5), 45, 0.8)
world = bpy.data.worlds.new("World"); scene.world = world; world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.004, 0.004, 0.005, 1)


def camera(name, loc, target, lens):
    cd = bpy.data.cameras.new(name); cd.lens = lens; cd.clip_start = 0.05
    cd.dof.use_dof = True; cd.dof.focus_distance = (Vector(target) - Vector(loc)).length - 0.08
    cd.dof.aperture_fstop = 5.6
    ob = bpy.data.objects.new(name, cd); col.objects.link(ob); ob.location = loc; aim(ob, target)
    return ob


cam_a = camera("CamClose", (-0.02, -1.02, 0.63), (-0.02, 0, 0.585), 50)
cam_b = camera("CamWide", (0.30, -1.68, 0.70), (0.0, 0, 0.635), 50)
scene.camera = cam_a
scene.timeline_markers.new("close", frame=1).camera = cam_a
scene.timeline_markers.new("wide", frame=CUT).camera = cam_b

# ---------------------------------------------------------------- 渲染设置
scene.render.engine = 'CYCLES'
cy = scene.cycles
cy.device = 'GPU'; cy.samples = 96; cy.use_adaptive_sampling = True; cy.adaptive_threshold = 0.02
cy.use_denoising = True
cy.transparent_max_bounces = 24; cy.max_bounces = 8
scene.render.resolution_x, scene.render.resolution_y = 1920, 1080
scene.render.image_settings.file_format = 'PNG'
scene.view_settings.look = 'AgX - Medium High Contrast'

bpy.ops.wm.save_as_mainfile(filepath=BLEND)
print("SAVED", BLEND)
