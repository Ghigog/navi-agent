extends Node
## Global error bus that replaces bare printerr() calls across all services.
##
## Usage:
##   ErrorBus.report("MyService: Something went wrong.")
##
## This prints to stderr (identical to printerr) and emits error_occurred so
## any listener (e.g. FairyVisuals) can react with a visual indicator such as
## the ⚠️ emoji notification.

## Emitted whenever ErrorBus.report() is called.
## [param message] is the raw error string.
signal error_occurred(message: String)


## Logs [param message] to stderr and emits [signal error_occurred].
## Drop-in replacement for printerr(); accepts the same variadic-style args
## by accepting a single pre-formatted String.
func report(message: String) -> void:
	printerr(message)
	error_occurred.emit(message)
