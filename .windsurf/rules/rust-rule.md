---
trigger: glob
globs: *.rs, **/*.rs
---

## Purpose
Automatically run `cargo check` after any changes to Rust source files to catch compilation errors and warnings early in the development process.

## Trigger Conditions
- **File Changes**: Only triggers when `.rs` files are modified
- **Scope**: Applies to all Rust files in the project and subdirectories

## Actions
1. Run `cargo check` to validate syntax and type checking
2. Display any compilation errors or warnings immediately
3. Ensure code quality before commits

## Benefits
- **Early Error Detection**: Catch issues before running or building
- **Fast Feedback**: `cargo check` is faster than full compilation
- **Code Quality**: Maintains consistent Rust standards
- **Developer Experience**: Reduces debugging time

## Note
This rule only activates on actual file changes to Rust source code, preventing unnecessary checks on unrelated file modifications.