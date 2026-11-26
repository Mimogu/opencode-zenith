extends CharacterBody3D
## Chases the node at target_path with a NavigationAgent3D child. Pair with templates/nav_level.tscn.

@export var target_path: NodePath
@export var speed := 4.0

@onready var agent: NavigationAgent3D = $NavigationAgent3D
@onready var target: Node3D = get_node_or_null(target_path)

func _ready() -> void:
	# an un-baked NavigationMesh is empty: bake once at start (the region must contain the floor geometry)
	var region := get_parent().get_node_or_null("NavigationRegion3D") as NavigationRegion3D
	if region:
		region.bake_navigation_mesh(false)

func _physics_process(delta: float) -> void:
	if not is_on_floor():
		velocity += get_gravity() * delta
	if target:
		agent.target_position = target.global_position
	if agent.is_navigation_finished():
		velocity.x = 0.0
		velocity.z = 0.0
	else:
		var next := agent.get_next_path_position()
		var dir := (next - global_position)
		dir.y = 0.0
		dir = dir.normalized()
		velocity.x = dir.x * speed
		velocity.z = dir.z * speed
	move_and_slide()
