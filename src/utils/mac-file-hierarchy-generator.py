import os
import json

def get_folder_tree(path, current_depth=0, max_depth=None, stop_paths=None):
    """
    Get folder tree structure.
    
    Args:
        path: Root path to scan
        current_depth: Current recursion depth (internal use)
        max_depth: Maximum depth to scan. None = unlimited.
        stop_paths: Set of absolute paths to stop at (don't recurse into)
    """
    tree = {}
    stop_paths = stop_paths or set()
    
    # Stop if we've hit max depth
    if max_depth is not None and current_depth >= max_depth:
        return tree
    
    for item in os.listdir(path):
        full_path = os.path.join(path, item)
        if os.path.isdir(full_path) and not item.startswith('.'):
            # If this path is in stop_paths, include it but don't recurse
            if full_path in stop_paths:
                tree[item] = {}  # Empty dict = no children shown
            else:
                tree[item] = get_folder_tree(full_path, current_depth + 1, max_depth, stop_paths)
    
    return tree

# Configuration
ROOT_PATH = '/Users/you/Documents'
OUTPUT_FILE = 'hierarchy.json'
MAX_DEPTH = None  # None = unlimited (except for stop_paths)

# Hard-coded paths to stop at (programming projects, etc.)
STOP_PATHS = {
    '/Users/you/Documents/Projects/block-diagram-generator',
    '/Users/you/Documents/Projects/migration-engine',
    '/Users/you/Documents/MIT/some-coding-class/assignments',
    # Add more as needed
}

# Generate and save
tree = get_folder_tree(ROOT_PATH, max_depth=MAX_DEPTH, stop_paths=STOP_PATHS)
with open(OUTPUT_FILE, 'w') as f:
    json.dump(tree, f, indent=2)

print(f"Saved to {OUTPUT_FILE}")