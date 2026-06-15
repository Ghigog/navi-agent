extends PanelContainer

signal confirmed(approved: bool)

@onready var description_label: Label = $VBox/DescriptionLabel
@onready var approve_button: Button = $VBox/ButtonRow/ApproveButton
@onready var deny_button: Button = $VBox/ButtonRow/DenyButton

func setup(description: String) -> void:
	# Wait for ready if not yet inside tree
	if not is_node_ready():
		await ready
	description_label.text = description

func _ready() -> void:
	approve_button.pressed.connect(func(): confirmed.emit(true))
	deny_button.pressed.connect(func(): confirmed.emit(false))
