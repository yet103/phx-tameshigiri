---
name: self-healing-executor
description: |
  A custom skill that executes commands or tests and automatically iterates on errors.
  It analyzes the error logs, patches code, and re-runs until success.
version: 1.0.0
---

# Self-Healing Executor

## Overview
This skill provides robust execution and autonomous debugging capabilities.
When a command fails, `self-healing-executor` will automatically read the stderr, determine the root cause, apply a fix to the related files, and retry the execution.

## Usage
Provide the command to execute. The skill will handle the rest.
