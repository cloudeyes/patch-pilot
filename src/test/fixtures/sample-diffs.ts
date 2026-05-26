/**
 * Test fixtures for diff samples
 */

/**
 * A well-formed sample diff with context
 */
export const WELL_FORMED_DIFF = `diff --git a/src/file.ts b/src/file.ts
--- a/src/file.ts
+++ b/src/file.ts
@@ -10,7 +10,7 @@ import React from 'react';
 import ReactDOM from 'react-dom';
 import './index.css';
-import App from './App';
+import { App } from './App';
 import reportWebVitals from './reportWebVitals';
 `;

/**
 * A missing header diff (common from AI systems)
 */
export const MISSING_HEADER_DIFF = `@@ -10,7 +10,7 @@ import React from 'react';
 import ReactDOM from 'react-dom';
 import './index.css';
-import App from './App';
+import { App } from './App';
 import reportWebVitals from './reportWebVitals';
`;

/**
 * A missing spaces diff (common from AI systems)
 */
export const MISSING_SPACES_DIFF = `diff --git a/src/file.ts b/src/file.ts
--- a/src/file.ts
+++ b/src/file.ts
@@ -10,7 +10,7 @@
import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';
-import App from './App';
+import { App } from './App';
import reportWebVitals from './reportWebVitals';
`;

/**
 * A mixed line endings diff
 */
export const MIXED_LINE_ENDINGS_DIFF = `diff --git a/src/file.ts b/src/file.ts\r
--- a/src/file.ts\r
+++ b/src/file.ts\r
@@ -10,7 +10,7 @@\r
 import React from 'react';\r
 import ReactDOM from 'react-dom';\r
 import './index.css';\r
-import App from './App';\r
+import { App } from './App';\r
 import reportWebVitals from './reportWebVitals';\r
`;

/**
 * A complex multi-file diff
 */
export const MULTI_FILE_DIFF = `diff --git a/src/file1.ts b/src/file1.ts
--- a/src/file1.ts
+++ b/src/file1.ts
@@ -10,7 +10,7 @@ import React from 'react';
 import ReactDOM from 'react-dom';
 import './index.css';
-import App from './App';
+import { App } from './App';
 import reportWebVitals from './reportWebVitals';

diff --git a/src/file2.ts b/src/file2.ts
--- a/src/file2.ts
+++ b/src/file2.ts
@@ -5,7 +5,7 @@ import { useState } from 'react';

 export function Component() {
   const [state, setState] = useState(false);
-  return <div>Component</div>;
+  return <div>{state ? 'True' : 'False'}</div>;
 }
`;

/**
 * A shifted context diff that would need fuzzy matching
 */
export const SHIFTED_CONTEXT_DIFF = `diff --git a/src/file.ts b/src/file.ts
--- a/src/file.ts
+++ b/src/file.ts
@@ -10,7 +10,7 @@ import React from 'react';
 import ReactDOM from 'react-dom';
 import './index.css';
-import App from './App';
+import { App } from './App';
 import reportWebVitals from './reportWebVitals';
`;

/**
 * Sample content for the file targeted by the diff
 */
export const SAMPLE_FILE_CONTENT = `import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById('root')
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
`;

/**
 * Sample content for the file with shifted line numbers
 */
export const SHIFTED_FILE_CONTENT = `// Added comment
// Another comment
import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById('root')
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
`;

/**
 * A file add diff
 */
export const ADD_FILE_DIFF = `diff --git a/dev/null b/src/new-file.ts
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/src/new-file.ts
@@ -0,0 +1,3 @@
+export const added = true;
+export function greet() {
+  return 'hello';
`;

/**
 * A file delete diff
 */
export const DELETE_FILE_DIFF = `diff --git a/src/old-file.ts b/dev/null
deleted file mode 100644
index e69de29..0000000
--- a/src/old-file.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-export const removed = true;
-export function legacy() {
-  return 'bye';
`;

/**
 * A rename-only diff
 */
export const RENAME_ONLY_DIFF = `diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 100%
rename from src/old-name.ts
rename to src/new-name.ts
`;

/**
 * A rename + modify diff
 */
export const RENAME_MODIFY_DIFF = `diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 85%
rename from src/old-name.ts
rename to src/new-name.ts
--- a/src/old-name.ts
+++ b/src/new-name.ts
@@ -1,3 +1,3 @@
 export const value = 1;
-export function oldName() {
+export function newName() {
  return value;
`;