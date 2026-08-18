/**
 * ============================================================
 * FILE PATH / NAME
 * ============================================================
 *
 * dev_scripts/player_features/repo-audit.mjs
 */


/**
 * ============================================================
 * FRAME CONN REPOSITORY AUDITOR
 * ============================================================
 *
 * ROLE:
 *   Performs a static integrity audit of the Frame Conn
 *   repository and writes a machine-readable JSON report.
 *
 * PURPOSE:
 *   Detect architecture and naming failures which can prevent the
 *   Foundry module from loading correctly.
 *
 * CHECKS:
 *   - Missing JavaScript imports.
 *   - Missing CSS imports.
 *   - Import path case mismatches.
 *   - Missing named exports.
 *   - Duplicate feature ids.
 *   - Duplicate provided capabilities.
 *   - Missing required feature capabilities.
 *   - Optional feature dependencies.
 *   - Feature-registry membership.
 *   - Executable UI registry membership.
 *   - module.json JavaScript entrypoint existence.
 *   - module.json stylesheet entrypoint existence.
 *   - Feature metadata file references.
 *   - Likely unregistered *-feature.js modules.
 *   - Likely unregistered ui-*.js feature modules.
 *   - Circular JavaScript import relationships.
 *   - Basic JSON validity.
 *
 * OUTPUT:
 *
 *   repo-audit-report.json
 *
 * RUN:
 *
 *   node dev_scripts/player_features/repo-audit.mjs
 *
 * OPTIONAL:
 *
 *   node dev_scripts/player_features/repo-audit.mjs --output dev_scripts/player_features/repo-audit-report.json
 *
 * DESIGN:
 *   Uses only Node.js built-in modules.
 *
 *   This is deliberately a static auditor. It does not execute
 *   Foundry or import application modules.
 */


/* ============================================================
   Imports
   ============================================================ */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";


/* ============================================================
   Script identity
   ============================================================ */

const SCRIPT_VERSION =
  "1.1.0";


const SCRIPT_FILE =
  fileURLToPath(
    import.meta.url
  );


const SCRIPT_DIRECTORY =
  path.dirname(
    SCRIPT_FILE
  );


const REPOSITORY_ROOT =
  path.resolve(
    SCRIPT_DIRECTORY,
    ".."
  );


/* ============================================================
   Audit configuration
   ============================================================ */

const IGNORED_DIRECTORIES =
  new Set([
    ".git",
    ".github",
    ".idea",
    ".vscode",
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".next",
    "backups",
    "patch-history"
  ]);


const SOURCE_EXTENSIONS =
  new Set([
    ".js",
    ".mjs",
    ".cjs",
    ".css",
    ".json"
  ]);


const JAVASCRIPT_EXTENSIONS =
  new Set([
    ".js",
    ".mjs",
    ".cjs"
  ]);


/* ============================================================
   Command-line configuration
   ============================================================ */

function getArgumentValue(
  name
) {
  const index =
    process.argv.indexOf(
      name
    );


  if (
    index < 0
  ) {
    return null;
  }


  return (
    process.argv[
      index + 1
    ] ??
    null
  );
}


const requestedOutput =
  getArgumentValue(
    "--output"
  );


const OUTPUT_FILE =
  requestedOutput
    ? path.resolve(
        REPOSITORY_ROOT,
        requestedOutput
      )
    : path.join(
        REPOSITORY_ROOT,
        "repo-audit-report.json"
      );


/* ============================================================
   Generic filesystem utilities
   ============================================================ */

function normalizeSlashes(
  value
) {
  return String(
    value
  ).replaceAll(
    "\\",
    "/"
  );
}


function relativePath(
  absolutePath
) {
  return normalizeSlashes(
    path.relative(
      REPOSITORY_ROOT,
      absolutePath
    )
  );
}


function fileExists(
  filePath
) {
  try {
    return (
      fs.statSync(
        filePath
      ).isFile()
    );
  } catch {
    return false;
  }
}


function directoryExists(
  directoryPath
) {
  try {
    return (
      fs.statSync(
        directoryPath
      ).isDirectory()
    );
  } catch {
    return false;
  }
}


function safeReadText(
  filePath
) {
  try {
    return fs.readFileSync(
      filePath,
      "utf8"
    );
  } catch {
    return null;
  }
}


/* ============================================================
   Repository file collection
   ============================================================ */

function collectRepositoryFiles(
  directory =
    REPOSITORY_ROOT
) {
  const files =
    [];


  for (
    const entry
    of fs.readdirSync(
      directory,
      {
        withFileTypes:
          true
      }
    )
  ) {
    if (
      entry.isDirectory() &&
      IGNORED_DIRECTORIES.has(
        entry.name
      )
    ) {
      continue;
    }


    const absolutePath =
      path.join(
        directory,
        entry.name
      );


    if (
      entry.isDirectory()
    ) {
      files.push(
        ...collectRepositoryFiles(
          absolutePath
        )
      );

      continue;
    }


    if (
      !entry.isFile()
    ) {
      continue;
    }


    if (
      SOURCE_EXTENSIONS.has(
        path.extname(
          entry.name
        ).toLowerCase()
      )
    ) {
      files.push(
        absolutePath
      );
    }
  }


  return files;
}


/* ============================================================
   Finding collection
   ============================================================ */

const findings =
  [];


function addFinding({
  severity,
  code,
  message,
  file = null,
  line = null,
  details = null
}) {
  findings.push({
    severity,
    code,
    message,

    file:
      file
        ? relativePath(
            file
          )
        : null,

    line,

    details
  });
}


/* ============================================================
   Line-number resolution
   ============================================================ */

function getLineNumber(
  text,
  index
) {
  if (
    !Number.isFinite(
      index
    ) ||
    index < 0
  ) {
    return null;
  }


  return (
    text
      .slice(
        0,
        index
      )
      .split(
        "\n"
      )
      .length
  );
}


/* ============================================================
   Import extraction
   ============================================================ */

function extractJavaScriptImports(
  text
) {
  const imports =
    [];


  const patterns = [
    {
      type:
        "static",

      regex:
        /^[ \t]*import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/gm
    },

    {
      type:
        "dynamic",

      regex:
        /import\s*\(\s*["']([^"']+)["']\s*\)/g
    }
  ];


  for (
    const {
      type,
      regex
    }
    of patterns
  ) {
    let match;


    while (
      (
        match =
          regex.exec(
            text
          )
      )
    ) {
      imports.push({
        type,

        source:
          match[1],

        index:
          match.index,

        statement:
          match[0]
      });
    }
  }


  return imports;
}


/* ============================================================
   CSS import extraction
   ============================================================ */

function extractCssImports(
  text
) {
  const imports =
    [];


  const regex =
    /@import\s+(?:url\()?["']([^"']+)["']\)?\s*;/g;


  let match;


  while (
    (
      match =
        regex.exec(
          text
        )
    )
  ) {
    imports.push({
      source:
        match[1],

      index:
        match.index
    });
  }


  return imports;
}


/* ============================================================
   Relative import resolution
   ============================================================ */

function possibleImportTargets(
  sourceFile,
  importSpecifier
) {
  if (
    !importSpecifier.startsWith(
      "."
    )
  ) {
    return [];
  }


  const base =
    path.resolve(
      path.dirname(
        sourceFile
      ),
      importSpecifier
    );


  if (
    path.extname(
      base
    )
  ) {
    return [
      base
    ];
  }


  return [
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    `${base}.json`,
    path.join(
      base,
      "index.js"
    ),
    path.join(
      base,
      "index.mjs"
    )
  ];
}


function resolveRelativeImport(
  sourceFile,
  importSpecifier
) {
  for (
    const candidate
    of possibleImportTargets(
      sourceFile,
      importSpecifier
    )
  ) {
    if (
      fileExists(
        candidate
      )
    ) {
      return candidate;
    }
  }


  return null;
}


/* ============================================================
   Case-sensitive path validation
   ============================================================ */

function inspectPathCase(
  absolutePath
) {
  const relative =
    path.relative(
      REPOSITORY_ROOT,
      absolutePath
    );


  const pieces =
    relative.split(
      path.sep
    );


  let current =
    REPOSITORY_ROOT;


  for (
    const piece
    of pieces
  ) {
    if (
      !directoryExists(
        current
      )
    ) {
      return null;
    }


    const entries =
      fs.readdirSync(
        current
      );


    if (
      entries.includes(
        piece
      )
    ) {
      current =
        path.join(
          current,
          piece
        );

      continue;
    }


    const caseInsensitiveMatch =
      entries.find(
        entry =>
          entry.toLowerCase() ===
          piece.toLowerCase()
      );


    if (
      caseInsensitiveMatch
    ) {
      return {
        requested:
          piece,

        actual:
          caseInsensitiveMatch,

        directory:
          relativePath(
            current
          )
      };
    }


    return null;
  }


  return null;
}


/* ============================================================
   JavaScript export extraction
   ============================================================ */

function extractNamedExports(
  text
) {
  const exports =
    new Set();


  const declarationRegex =
    /export\s+(?:const|let|var|function|class|async\s+function)\s+([A-Za-z_$][\w$]*)/g;


  let match;


  while (
    (
      match =
        declarationRegex.exec(
          text
        )
    )
  ) {
    exports.add(
      match[1]
    );
  }


  const exportBlockRegex =
    /export\s*\{([\s\S]*?)\}/g;


  while (
    (
      match =
        exportBlockRegex.exec(
          text
        )
    )
  ) {
    const body =
      match[1];


    for (
      const rawEntry
      of body.split(
        ","
      )
    ) {
      const entry =
        rawEntry.trim();


      if (
        !entry
      ) {
        continue;
      }


      const aliasMatch =
        entry.match(
          /(?:^|\s)([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/
        );


      if (
        aliasMatch
      ) {
        exports.add(
          aliasMatch[2]
        );

        continue;
      }


      const identifier =
        entry.match(
          /^([A-Za-z_$][\w$]*)$/
        );


      if (
        identifier
      ) {
        exports.add(
          identifier[1]
        );
      }
    }
  }


  return exports;
}


/* ============================================================
   Named import extraction
   ============================================================ */

function extractNamedImports(
  statement
) {
  const match =
    statement.match(
      /import\s*\{([\s\S]*?)\}\s*from/
    );


  if (
    !match
  ) {
    return [];
  }


  return (
    match[1]
      .split(
        ","
      )
      .map(
        entry =>
          entry.trim()
      )
      .filter(
        Boolean
      )
      .map(
        entry => {
          const aliasMatch =
            entry.match(
              /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/
            );


          return aliasMatch
            ? aliasMatch[1]
            : entry;
        }
      )
  );
}


/* ============================================================
   Balanced object extraction
   ============================================================ */

function extractBalancedObjectAfter(
  text,
  startIndex
) {
  const objectStart =
    text.indexOf(
      "{",
      startIndex
    );


  if (
    objectStart < 0
  ) {
    return null;
  }


  let depth =
    0;

  let quote =
    null;

  let escaped =
    false;


  for (
    let index =
      objectStart;

    index <
    text.length;

    index +=
      1
  ) {
    const character =
      text[index];


    if (
      quote
    ) {
      if (
        escaped
      ) {
        escaped =
          false;

        continue;
      }


      if (
        character ===
        "\\"
      ) {
        escaped =
          true;

        continue;
      }


      if (
        character ===
        quote
      ) {
        quote =
          null;
      }


      continue;
    }


    if (
      character ===
        "'" ||
      character ===
        '"' ||
      character ===
        "`"
    ) {
      quote =
        character;

      continue;
    }


    if (
      character ===
      "{"
    ) {
      depth +=
        1;

      continue;
    }


    if (
      character ===
      "}"
    ) {
      depth -=
        1;


      if (
        depth ===
        0
      ) {
        return {
          text:
            text.slice(
              objectStart,
              index + 1
            ),

          start:
            objectStart,

          end:
            index + 1
        };
      }
    }
  }


  return null;
}


/* ============================================================
   Static feature-property extraction
   ============================================================ */

function extractStringProperty(
  objectText,
  property
) {
  const regex =
    new RegExp(
      `\\b${property}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`
    );


  return (
    objectText.match(
      regex
    )?.[1] ??
    null
  );
}


function extractStringArrayProperty(
  objectText,
  property
) {
  const regex =
    new RegExp(
      `\\b${property}\\s*:\\s*\\[([\\s\\S]*?)\\]`
    );


  const match =
    objectText.match(
      regex
    );


  if (
    !match
  ) {
    return [];
  }


  const values =
    [];


  const stringRegex =
    /["'`]([^"'`]+)["'`]/g;


  let stringMatch;


  while (
    (
      stringMatch =
        stringRegex.exec(
          match[1]
        )
    )
  ) {
    values.push(
      stringMatch[1]
    );
  }


  return values;
}


/* ============================================================
   Feature declaration extraction
   ============================================================ */

function extractFeatureDeclarations(
  filePath,
  text
) {
  const features =
    [];


  const callPattern =
    /\bdefineFrameConnFeature\s*\(/g;


  let searchIndex =
    0;


  while (
    true
  ) {
    callPattern.lastIndex =
      searchIndex;


    const callMatch =
      callPattern.exec(
        text
      );


    if (
      !callMatch
    ) {
      break;
    }


    const callIndex =
      callMatch.index;


    const openParenthesis =
      text.indexOf(
        "(",
        callIndex
      );


    if (
      openParenthesis <
      0
    ) {
      break;
    }


    const object =
      extractBalancedObjectAfter(
        text,
        openParenthesis
      );


    if (
      !object
    ) {
      searchIndex =
        openParenthesis +
        1;

      continue;
    }


    const id =
      extractStringProperty(
        object.text,
        "id"
      );


    /*
     * Some feature ids are constants:
     *
     *   id: MOVEMENT_UI_FEATURE_ID
     *
     * Try to resolve simple constant declarations.
     */
    let resolvedId =
      id;


    if (
      !resolvedId
    ) {
      const idIdentifier =
        object.text.match(
          /\bid\s*:\s*([A-Za-z_$][\w$]*)/
        )?.[1];


      if (
        idIdentifier
      ) {
        const constantRegex =
          new RegExp(
            `(?:const|let|var)\\s+${idIdentifier}\\s*=\\s*["'\`]([^"'\`]+)["'\`]`
          );


        resolvedId =
          text.match(
            constantRegex
          )?.[1] ??
          null;
      }
    }


    features.push({
      file:
        filePath,

      line:
        getLineNumber(
          text,
          callIndex
        ),

      id:
        resolvedId,

      domain:
        extractStringProperty(
          object.text,
          "domain"
        ),

      provides:
        extractStringArrayProperty(
          object.text,
          "provides"
        ),

      dependsOn:
        extractStringArrayProperty(
          object.text,
          "dependsOn"
        ),

      optionalDependsOn:
        extractStringArrayProperty(
          object.text,
          "optionalDependsOn"
        )
    });


    searchIndex =
      object.end;
  }


  return features;
}


/* ============================================================
   Metadata path extraction
   ============================================================ */

function extractLikelyRepositoryPaths(
  text
) {
  const results =
    [];


  const regex =
    /["'`]((?:scripts|styles|templates|assets|lang|packs)\/[^"'`]+\.(?:js|mjs|css|json|html|hbs))["'`]/g;


  let match;


  while (
    (
      match =
        regex.exec(
          text
        )
    )
  ) {
    results.push({
      path:
        match[1],

      index:
        match.index
    });
  }


  return results;
}


/* ============================================================
   JSON validation
   ============================================================ */

function auditJsonFiles(
  files
) {
  for (
    const file
    of files
  ) {
    if (
      path.extname(
        file
      ).toLowerCase() !==
      ".json"
    ) {
      continue;
    }


    const text =
      safeReadText(
        file
      );


    if (
      text ===
      null
    ) {
      addFinding({
        severity:
          "error",

        code:
          "JSON_READ_FAILED",

        message:
          "JSON file could not be read.",

        file
      });

      continue;
    }


    try {
      JSON.parse(
        text
      );
    } catch (error) {
      addFinding({
        severity:
          "error",

        code:
          "INVALID_JSON",

        message:
          error.message,

        file
      });
    }
  }
}


/* ============================================================
   JavaScript import audit
   ============================================================ */

function auditJavaScriptImports(
  javascriptFiles,
  textByFile
) {
  const dependencyGraph =
    new Map();


  for (
    const file
    of javascriptFiles
  ) {
    const text =
      textByFile.get(
        file
      );


    const imports =
      extractJavaScriptImports(
        text
      );


    const dependencies =
      [];


    for (
      const imported
      of imports
    ) {
      if (
        !imported.source.startsWith(
          "."
        )
      ) {
        continue;
      }


      const resolved =
        resolveRelativeImport(
          file,
          imported.source
        );


      if (
        !resolved
      ) {
        addFinding({
          severity:
            "error",

          code:
            "MISSING_JS_IMPORT",

          message:
            `Cannot resolve JavaScript import "${imported.source}".`,

          file,

          line:
            getLineNumber(
              text,
              imported.index
            ),

          details: {
            import:
              imported.source
          }
        });

        continue;
      }


      dependencies.push(
        resolved
      );


      const caseMismatch =
        inspectPathCase(
          resolved
        );


      if (
        caseMismatch
      ) {
        addFinding({
          severity:
            "error",

          code:
            "IMPORT_PATH_CASE_MISMATCH",

          message:
            `Import path casing does not match the repository filesystem.`,

          file,

          line:
            getLineNumber(
              text,
              imported.index
            ),

          details: {
            import:
              imported.source,

            ...caseMismatch
          }
        });
      }


      const importedNames =
        extractNamedImports(
          imported.statement
        );


      if (
        importedNames.length ===
        0
      ) {
        continue;
      }


      const targetText =
        textByFile.get(
          resolved
        ) ??
        safeReadText(
          resolved
        ) ??
        "";


      const exports =
        extractNamedExports(
          targetText
        );


      for (
        const importedName
        of importedNames
      ) {
        if (
          !exports.has(
            importedName
          )
        ) {
          addFinding({
            severity:
              "error",

            code:
              "MISSING_NAMED_EXPORT",

            message:
              `Imported symbol "${importedName}" was not found as a static named export of "${relativePath(resolved)}".`,

            file,

            line:
              getLineNumber(
                text,
                imported.index
              ),

            details: {
              importedName,

              import:
                imported.source,

              target:
                relativePath(
                  resolved
                )
            }
          });
        }
      }
    }


    dependencyGraph.set(
      file,
      dependencies
    );
  }


  return dependencyGraph;
}


/* ============================================================
   CSS import audit
   ============================================================ */

function auditCssImports(
  cssFiles,
  textByFile
) {
  for (
    const file
    of cssFiles
  ) {
    const text =
      textByFile.get(
        file
      );


    for (
      const imported
      of extractCssImports(
        text
      )
    ) {
      if (
        !imported.source.startsWith(
          "."
        )
      ) {
        continue;
      }


      const target =
        path.resolve(
          path.dirname(
            file
          ),
          imported.source
        );


      if (
        !fileExists(
          target
        )
      ) {
        addFinding({
          severity:
            "error",

          code:
            "MISSING_CSS_IMPORT",

          message:
            `Cannot resolve CSS import "${imported.source}".`,

          file,

          line:
            getLineNumber(
              text,
              imported.index
            ),

          details: {
            import:
              imported.source
          }
        });

        continue;
      }


      const caseMismatch =
        inspectPathCase(
          target
        );


      if (
        caseMismatch
      ) {
        addFinding({
          severity:
            "error",

          code:
            "CSS_IMPORT_PATH_CASE_MISMATCH",

          message:
            "CSS import path casing does not match the repository filesystem.",

          file,

          line:
            getLineNumber(
              text,
              imported.index
            ),

          details: {
            import:
              imported.source,

            ...caseMismatch
          }
        });
      }
    }
  }
}


/* ============================================================
   Feature graph audit
   ============================================================ */

function auditFeatureGraph(
  features
) {
  const byId =
    new Map();


  const capabilityProviders =
    new Map();


  for (
    const feature
    of features
  ) {
    if (
      !feature.id
    ) {
      addFinding({
        severity:
          "warning",

        code:
          "FEATURE_ID_NOT_STATICALLY_RESOLVED",

        message:
          "A defineFrameConnFeature declaration was found, but its id could not be resolved statically.",

        file:
          feature.file,

        line:
          feature.line
      });

      continue;
    }


    if (
      byId.has(
        feature.id
      )
    ) {
      addFinding({
        severity:
          "error",

        code:
          "DUPLICATE_FEATURE_ID",

        message:
          `Feature id "${feature.id}" is declared more than once.`,

        file:
          feature.file,

        line:
          feature.line,

        details: {
          firstDeclaration:
            relativePath(
              byId.get(
                feature.id
              ).file
            )
        }
      });
    } else {
      byId.set(
        feature.id,
        feature
      );
    }


    for (
      const capability
      of feature.provides
    ) {
      if (
        capabilityProviders.has(
          capability
        )
      ) {
        const existing =
          capabilityProviders.get(
            capability
          );


        addFinding({
          severity:
            "error",

          code:
            "DUPLICATE_CAPABILITY_PROVIDER",

          message:
            `Capability "${capability}" is provided by multiple features.`,

          file:
            feature.file,

          line:
            feature.line,

          details: {
            feature:
              feature.id,

            existingFeature:
              existing.id,

            existingFile:
              relativePath(
                existing.file
              )
          }
        });
      } else {
        capabilityProviders.set(
          capability,
          feature
        );
      }
    }
  }


  for (
    const feature
    of features
  ) {
    for (
      const dependency
      of feature.dependsOn
    ) {
      if (
        !capabilityProviders.has(
          dependency
        )
      ) {
        addFinding({
          severity:
            "error",

          code:
            "MISSING_REQUIRED_CAPABILITY",

          message:
            `Feature "${feature.id ?? "unknown"}" requires capability "${dependency}", but no feature provides it.`,

          file:
            feature.file,

          line:
            feature.line,

          details: {
            featureId:
              feature.id,

            dependency
          }
        });
      }
    }


    for (
      const dependency
      of feature.optionalDependsOn
    ) {
      if (
        !capabilityProviders.has(
          dependency
        )
      ) {
        addFinding({
          severity:
            "info",

          code:
            "OPTIONAL_CAPABILITY_UNAVAILABLE",

          message:
            `Optional capability "${dependency}" requested by feature "${feature.id ?? "unknown"}" has no provider.`,

          file:
            feature.file,

          line:
            feature.line,

          details: {
            featureId:
              feature.id,

            dependency
          }
        });
      }
    }
  }


  return {
    byId,
    capabilityProviders
  };
}


/* ============================================================
   Feature-registry membership audit
   ============================================================ */

function auditRuntimeFeatureRegistration(
  javascriptFiles,
  textByFile,
  features
) {
  const playerRegistryPath =
    path.join(
      REPOSITORY_ROOT,
      "scripts",
      "player_features",
      "player-feature-registry.js"
    );

  const rulesRegistryPath =
    path.join(
      REPOSITORY_ROOT,
      "scripts",
      "rules_features",
      "rules-feature-registry.js"
    );

  const playerRegistryText =
    textByFile.get(
      playerRegistryPath
    ) ??
    safeReadText(
      playerRegistryPath
    );

  const rulesRegistryText =
    textByFile.get(
      rulesRegistryPath
    ) ??
    safeReadText(
      rulesRegistryPath
    );

  if (
    !playerRegistryText ||
    !rulesRegistryText
  ) {
    addFinding({
      severity:
        "error",

      code:
        "FEATURE_REGISTRY_MISSING",

      message:
        "Player and rules feature registries must both be present.",

      file:
        !playerRegistryText
          ? playerRegistryPath
          : rulesRegistryPath
    });

    return;
  }


  const runtimeFeatureFiles =
    javascriptFiles.filter(
      file => {
        const relative =
          relativePath(
            file
          );


        return (
          (
            relative.startsWith(
              "scripts/player_features/"
            ) ||
            relative.startsWith(
              "scripts/rules_features/"
            )
          ) &&
          relative.endsWith(
            "-feature.js"
          ) &&
          !relative.endsWith(
            "feature-registry-core.js"
          )
        );
      }
    );


  for (
    const file
    of runtimeFeatureFiles
  ) {
    const text =
      textByFile.get(
        file
      );


    const declarations =
      features.filter(
        feature =>
          feature.file ===
          file
      );


    if (
      declarations.length ===
      0
    ) {
      continue;
    }


    const relative =
      relativePath(
        file
      );

    const isRulesFeature =
      relative.startsWith(
        "scripts/rules_features/"
      );

    const registryRoot =
      isRulesFeature
        ? "scripts/rules_features/"
        : "scripts/player_features/";

    const registryText =
      isRulesFeature
        ? rulesRegistryText
        : playerRegistryText;

    const registryLabel =
      isRulesFeature
        ? "scripts/rules_features/rules-feature-registry.js"
        : "scripts/player_features/player-feature-registry.js";

    const importSpecifier =
      `./${relative.slice(registryRoot.length)}`;

    if (
      !registryText.includes(
        importSpecifier
      )
    ) {
      addFinding({
        severity:
          "warning",

        code:
          "RUNTIME_FEATURE_NOT_IMPORTED_BY_REGISTRY",

        message:
          `Runtime feature appears to declare a Frame Conn feature but is not imported by ${registryLabel}.`,

        file,

        details: {
          expectedImport:
            importSpecifier,

          registry:
            registryLabel
        }
      });
    }
  }
}


/* ============================================================
   UI feature-registry membership audit
   ============================================================ */

function auditUiFeatureRegistration(
  javascriptFiles,
  textByFile,
  features
) {
  const registryPath =
    path.join(
      REPOSITORY_ROOT,
      "styles",
      "ui-registry.js"
    );


  const registryText =
    textByFile.get(
      registryPath
    ) ??
    safeReadText(
      registryPath
    );


  if (
    !registryText
  ) {
    addFinding({
      severity:
        "error",

      code:
        "UI_REGISTRY_MISSING",

      message:
        "styles/ui-registry.js could not be found or read.",

      file:
        registryPath
    });

    return;
  }


  const uiFeatureFiles =
    javascriptFiles.filter(
      file => {
        const relative =
          relativePath(
            file
          );


        return (
          relative.startsWith(
            "styles/ui-"
          ) &&
          relative.endsWith(
            ".js"
          ) &&
          relative !==
            "styles/ui-registry.js"
        );
      }
    );


  for (
    const file
    of uiFeatureFiles
  ) {
    const declarations =
      features.filter(
        feature =>
          feature.file ===
          file
      );


    /*
     * ui-sensors.js is intentionally adapted by ui-registry.js,
     * so any ui-* module is worth checking for package inclusion
     * even when it does not self-declare.
     */
    const importSpecifier =
      `./${relativePath(file).slice("styles/".length)}`;


    if (
      !registryText.includes(
        importSpecifier
      )
    ) {
      addFinding({
        severity:
          declarations.length >
          0
            ? "warning"
            : "info",

        code:
          "UI_MODULE_NOT_IMPORTED_BY_UI_REGISTRY",

        message:
          `Executable UI module is not imported by styles/ui-registry.js.`,

        file,

        details: {
          expectedImport:
            importSpecifier,

          declaresFeature:
            declarations.length >
            0
        }
      });
    }
  }
}


/* ============================================================
   module.json audit
   ============================================================ */

function auditModuleManifest() {
  const moduleJsonPath =
    path.join(
      REPOSITORY_ROOT,
      "module.json"
    );


  const text =
    safeReadText(
      moduleJsonPath
    );


  if (
    !text
  ) {
    addFinding({
      severity:
        "error",

      code:
        "MODULE_JSON_MISSING",

      message:
        "module.json could not be found or read.",

      file:
        moduleJsonPath
    });

    return null;
  }


  let manifest;


  try {
    manifest =
      JSON.parse(
        text
      );
  } catch {
    return null;
  }


  for (
    const entry
    of manifest.esmodules ??
    []
  ) {
    const target =
      path.resolve(
        REPOSITORY_ROOT,
        entry
      );


    if (
      !fileExists(
        target
      )
    ) {
      addFinding({
        severity:
          "error",

        code:
          "MODULE_ESMODULE_MISSING",

        message:
          `module.json esmodule "${entry}" does not exist.`,

        file:
          moduleJsonPath,

        details: {
          entry
        }
      });
    }
  }


  for (
    const entry
    of manifest.styles ??
    []
  ) {
    const target =
      path.resolve(
        REPOSITORY_ROOT,
        entry
      );


    if (
      !fileExists(
        target
      )
    ) {
      addFinding({
        severity:
          "error",

        code:
          "MODULE_STYLESHEET_MISSING",

        message:
          `module.json stylesheet "${entry}" does not exist.`,

        file:
          moduleJsonPath,

        details: {
          entry
        }
      });
    }
  }


  if (
    !manifest.id
  ) {
    addFinding({
      severity:
        "error",

      code:
        "MODULE_ID_MISSING",

      message:
        "module.json does not declare an id.",

      file:
        moduleJsonPath
    });
  }


  if (
    !manifest.version
  ) {
    addFinding({
      severity:
        "warning",

      code:
        "MODULE_VERSION_MISSING",

      message:
        "module.json does not declare a version.",

      file:
        moduleJsonPath
    });
  }


  return manifest;
}


/* ============================================================
   Metadata repository-path audit
   ============================================================ */

function auditMetadataPaths(
  javascriptFiles,
  textByFile
) {
  for (
    const file
    of javascriptFiles
  ) {
    const text =
      textByFile.get(
        file
      );


    for (
      const reference
      of extractLikelyRepositoryPaths(
        text
      )
    ) {
      const target =
        path.resolve(
          REPOSITORY_ROOT,
          reference.path
        );


      /*
       * Avoid treating documentation examples beginning with
       * "future..." etc. as fatal when the containing text clearly
       * describes them as future examples.
       */
      const surrounding =
        text
          .slice(
            Math.max(
              0,
              reference.index -
              150
            ),
            reference.index +
            reference.path.length +
            150
          )
          .toLowerCase();


      const appearsHypothetical =
        surrounding.includes(
          "future"
        ) ||
        surrounding.includes(
          "example"
        ) ||
        surrounding.includes(
          "may live"
        ) ||
        surrounding.includes(
          "may move"
        );


      if (
        !fileExists(
          target
        ) &&
        !appearsHypothetical
      ) {
        addFinding({
          severity:
            "warning",

          code:
            "REFERENCED_REPOSITORY_FILE_MISSING",

          message:
            `Repository file reference "${reference.path}" does not exist.`,

          file,

          line:
            getLineNumber(
              text,
              reference.index
            ),

          details: {
            referencedPath:
              reference.path
          }
        });
      }
    }
  }
}


/* ============================================================
   Circular JavaScript dependency audit
   ============================================================ */

function auditCircularDependencies(
  dependencyGraph
) {
  const visiting =
    new Set();


  const visited =
    new Set();


  const reported =
    new Set();


  function visit(
    file,
    stack
  ) {
    if (
      visiting.has(
        file
      )
    ) {
      const cycleStart =
        stack.indexOf(
          file
        );


      const cycle =
        [
          ...stack.slice(
            cycleStart
          ),
          file
        ];


      const normalized =
        cycle
          .map(
            relativePath
          )
          .join(
            " -> "
          );


      if (
        !reported.has(
          normalized
        )
      ) {
        reported.add(
          normalized
        );


        addFinding({
          severity:
            "warning",

          code:
            "CIRCULAR_JS_IMPORT",

          message:
            "Circular JavaScript import dependency detected.",

          file,

          details: {
            cycle:
              cycle.map(
                relativePath
              )
          }
        });
      }


      return;
    }


    if (
      visited.has(
        file
      )
    ) {
      return;
    }


    visiting.add(
      file
    );


    stack.push(
      file
    );


    for (
      const dependency
      of dependencyGraph.get(
        file
      ) ??
      []
    ) {
      if (
        dependencyGraph.has(
          dependency
        )
      ) {
        visit(
          dependency,
          stack
        );
      }
    }


    stack.pop();


    visiting.delete(
      file
    );


    visited.add(
      file
    );
  }


  for (
    const file
    of dependencyGraph.keys()
  ) {
    visit(
      file,
      []
    );
  }
}


/* ============================================================
   Duplicate basename audit
   ============================================================ */

function auditDuplicateBasenames(
  files
) {
  const byBasename =
    new Map();


  for (
    const file
    of files
  ) {
    const basename =
      path.basename(
        file
      );


    const group =
      byBasename.get(
        basename
      ) ??
      [];


    group.push(
      file
    );


    byBasename.set(
      basename,
      group
    );
  }


  for (
    const [
      basename,
      group
    ]
    of byBasename
  ) {
    if (
      group.length <
      2
    ) {
      continue;
    }


    addFinding({
      severity:
        "info",

      code:
        "DUPLICATE_FILE_BASENAME",

      message:
        `Multiple repository files share the basename "${basename}".`,

      details: {
        files:
          group.map(
            relativePath
          )
      }
    });
  }
}



/* ============================================================
   Dependency watershed model
   ============================================================ */

/**
 * Extract statically named declarations so stream-size statistics
 * describe participating code symbols rather than raw line counts.
 *
 * This intentionally remains conservative: anonymous expressions,
 * object properties, and runtime-generated names are not counted.
 */
function extractDeclaredSymbols(
  text
) {
  const symbols =
    new Set();


  const patterns = [
    /(?:^|\n)[ \t]*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /(?:^|\n)[ \t]*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g,
    /(?:^|\n)[ \t]*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g
  ];


  for (
    const regex
    of patterns
  ) {
    let match;


    while (
      (
        match =
          regex.exec(
            text
          )
      )
    ) {
      symbols.add(
        match[1]
      );
    }
  }


  for (
    const exported
    of extractNamedExports(
      text
    )
  ) {
    symbols.add(
      exported
    );
  }


  return symbols;
}


function collectDependencyClosure(
  entryFile,
  dependencyGraph,
  featureFiles
) {
  const visited =
    new Set();

  const stack =
    [
      entryFile
    ];


  while (
    stack.length >
    0
  ) {
    const file =
      stack.pop();


    if (
      visited.has(
        file
      )
    ) {
      continue;
    }


    visited.add(
      file
    );


    for (
      const dependency
      of dependencyGraph.get(
        file
      ) ??
      []
    ) {
      if (
        featureFiles.has(
          dependency
        ) &&
        dependency !==
        entryFile
      ) {
        continue;
      }


      if (
        dependencyGraph.has(
          dependency
        )
      ) {
        stack.push(
          dependency
        );
      }
    }
  }


  return visited;
}


function collectReachableDependencies(
  entryFiles,
  dependencyGraph
) {
  const visited =
    new Set();

  const stack =
    entryFiles
      .filter(
        file =>
          dependencyGraph.has(
            file
          )
      );


  while (
    stack.length >
    0
  ) {
    const file =
      stack.pop();


    if (
      visited.has(
        file
      )
    ) {
      continue;
    }


    visited.add(
      file
    );


    for (
      const dependency
      of dependencyGraph.get(
        file
      ) ??
      []
    ) {
      if (
        dependencyGraph.has(
          dependency
        )
      ) {
        stack.push(
          dependency
        );
      }
    }
  }


  return visited;
}


function dependencyStreamRiver(
  feature
) {
  const relative =
    relativePath(
      feature.file
    );


  return (
    feature.domain?.startsWith(
      "ui."
    ) ||
    feature.id?.startsWith(
      "ui-"
    ) ||
    relative.startsWith(
      "styles/"
    )
  )
    ? "ui"
    : "runtime";
}


const DEPENDENCY_TOPOLOGY_FINDING_CODES =
  new Set([
    "MISSING_JS_IMPORT",
    "IMPORT_PATH_CASE_MISMATCH",
    "MISSING_NAMED_EXPORT",
    "DUPLICATE_FEATURE_ID",
    "DUPLICATE_CAPABILITY_PROVIDER",
    "MISSING_REQUIRED_CAPABILITY",
    "RUNTIME_FEATURE_NOT_IMPORTED_BY_REGISTRY",
    "UI_MODULE_NOT_IMPORTED_BY_UI_REGISTRY",
    "CIRCULAR_JS_IMPORT",
    "MODULE_ESMODULE_MISSING",
    "MODULE_STYLESHEET_MISSING",
    "DEPENDENCY_STREAM_DEAD_END"
  ]);


function dependencyProblemsForFiles(
  streamFiles
) {
  const relativeFiles =
    new Set(
      [
        ...streamFiles
      ].map(
        relativePath
      )
    );


  return findings
    .filter(
      finding =>
        DEPENDENCY_TOPOLOGY_FINDING_CODES.has(
          finding.code
        ) &&
        (
          !finding.file ||
          relativeFiles.has(
            finding.file
          )
        )
    )
    .map(
      finding => ({
        severity:
          finding.severity,

        code:
          finding.code,

        message:
          finding.message,

        file:
          finding.file,

        line:
          finding.line,

        details:
          finding.details
      })
    );
}


function buildDependencyWatershed({
  files,
  javascriptFiles,
  textByFile,
  dependencyGraph,
  features,
  featureGraph,
  manifest
}) {
  const resolvedFeatures =
    features.filter(
      feature =>
        Boolean(
          feature.id
        )
    );


  const featureFiles =
    new Set(
      resolvedFeatures.map(
        feature =>
          feature.file
      )
    );


  const outletFiles =
    (
      manifest?.esmodules ??
      []
    )
      .map(
        entry =>
          path.resolve(
            REPOSITORY_ROOT,
            entry
          )
      )
      .filter(
        file =>
          dependencyGraph.has(
            file
          )
      );


  const reachableFromOutlets =
    collectReachableDependencies(
      outletFiles,
      dependencyGraph
    );


  const streamById =
    new Map();


  for (
    const feature
    of resolvedFeatures
  ) {
    const streamFiles =
      collectDependencyClosure(
        feature.file,
        dependencyGraph,
        featureFiles
      );


    const symbols =
      new Set();


    for (
      const file
      of streamFiles
    ) {
      const text =
        textByFile.get(
          file
        ) ??
        "";


      for (
        const symbol
        of extractDeclaredSymbols(
          text
        )
      ) {
        symbols.add(
          symbol
        );
      }
    }


    const requiredProviders =
      feature.dependsOn
        .map(
          capability =>
            featureGraph
              .capabilityProviders
              .get(
                capability
              )
        )
        .filter(
          Boolean
        );


    const optionalProviders =
      feature.optionalDependsOn
        .map(
          capability =>
            featureGraph
              .capabilityProviders
              .get(
                capability
              )
        )
        .filter(
          Boolean
        );


    const upstreamStreams =
      [
        ...new Set(
          [
            ...requiredProviders,
            ...optionalProviders
          ]
            .map(
              provider =>
                provider.id
            )
            .filter(
              id =>
                id &&
                id !==
                feature.id
            )
        )
      ]
        .sort();


    const river =
      dependencyStreamRiver(
        feature
      );


    const deadEnd =
      outletFiles.length >
        0 &&
      !reachableFromOutlets.has(
        feature.file
      );


    if (
      deadEnd
    ) {
      addFinding({
        severity:
          "warning",

        code:
          "DEPENDENCY_STREAM_DEAD_END",

        message:
          `Dependency stream "${feature.id}" does not reach a declared module runtime outlet.`,

        file:
          feature.file,

        line:
          feature.line,

        details: {
          featureId:
            feature.id,

          outlets:
            outletFiles.map(
              relativePath
            )
        }
      });
    }


    streamById.set(
      feature.id,
      {
        id:
          feature.id,

        domain:
          feature.domain,

        river,

        entryFile:
          relativePath(
            feature.file
          ),

        fileCount:
          streamFiles.size,

        symbolCount:
          symbols.size,

        provides:
          [
            ...feature.provides
          ]
            .sort(),

        consumes:
          [
            ...feature.dependsOn
          ]
            .sort(),

        optionalConsumes:
          [
            ...feature.optionalDependsOn
          ]
            .sort(),

        dependencyJoinCount:
          requiredProviders.length +
          optionalProviders.length,

        upstreamStreams,

        downstreamStreams:
          [],

        convergence:
          river ===
          "ui"
            ? "styles/ui-registry.js"
            : "scripts/player_features/player-feature-registry.js",

        outlet:
          outletFiles.length >
          0
            ? relativePath(
                outletFiles[0]
              )
            : null,

        deadEnd,

        _files:
          streamFiles,

        _symbols:
          symbols
      }
    );
  }


  for (
    const stream
    of streamById.values()
  ) {
    for (
      const upstreamId
      of stream.upstreamStreams
    ) {
      const upstream =
        streamById.get(
          upstreamId
        );


      if (
        upstream &&
        !upstream
          .downstreamStreams
          .includes(
            stream.id
          )
      ) {
        upstream
          .downstreamStreams
          .push(
            stream.id
          );
      }
    }
  }


  for (
    const stream
    of streamById.values()
  ) {
    stream.downstreamStreams.sort();


    const problems =
      dependencyProblemsForFiles(
        stream._files
      );


    stream.status =
      problems.some(
        problem =>
          problem.severity ===
          "error"
      )
        ? "error"
        : problems.length >
            0
          ? "warning"
          : "healthy";


    stream.problems =
      stream.status ===
      "healthy"
        ? []
        : problems;
  }


  const riverDefinitions = [
    {
      id:
        "runtime",

      label:
        "Runtime River",

      convergence:
        "scripts/player_features/player-feature-registry.js"
    },

    {
      id:
        "ui",

      label:
        "UI River",

      convergence:
        "styles/ui-registry.js"
    }
  ];


  const rivers =
    riverDefinitions
      .map(
        definition => {
          const streams =
            [
              ...streamById.values()
            ]
              .filter(
                stream =>
                  stream.river ===
                  definition.id
              )
              .sort(
                (
                  left,
                  right
                ) =>
                  left.id.localeCompare(
                    right.id
                  )
              );


          if (
            streams.length ===
            0
          ) {
            return null;
          }


          const riverFiles =
            new Set();

          const riverSymbols =
            new Set();


          for (
            const stream
            of streams
          ) {
            for (
              const file
              of stream._files
            ) {
              riverFiles.add(
                file
              );
            }


            for (
              const symbol
              of stream._symbols
            ) {
              riverSymbols.add(
                symbol
              );
            }
          }


          return {
            id:
              definition.id,

            label:
              definition.label,

            streamCount:
              streams.length,

            fileCount:
              riverFiles.size,

            symbolCount:
              riverSymbols.size,

            dependencyJoinCount:
              streams.reduce(
                (
                  total,
                  stream
                ) =>
                  total +
                  stream.dependencyJoinCount,
                0
              ),

            convergence:
              definition.convergence,

            outlet:
              outletFiles.length >
              0
                ? relativePath(
                    outletFiles[0]
                  )
                : null,

            streams:
              streams.map(
                stream => {
                  const {
                    _files,
                    _symbols,
                    ...serializable
                  } =
                    stream;


                  return serializable;
                }
              )
          };
        }
      )
      .filter(
        Boolean
      );


  const participatingSymbols =
    new Set();


  for (
    const stream
    of streamById.values()
  ) {
    for (
      const symbol
      of stream._symbols
    ) {
      participatingSymbols.add(
        symbol
      );
    }
  }


  const dependencyEdgeCount =
    [
      ...dependencyGraph.values()
    ].reduce(
      (
        total,
        dependencies
      ) =>
        total +
        dependencies.length,
      0
    );


  const cycleCount =
    findings.filter(
      finding =>
        finding.code ===
        "CIRCULAR_JS_IMPORT"
    ).length;


  const missingProviderCount =
    findings.filter(
      finding =>
        finding.code ===
        "MISSING_REQUIRED_CAPABILITY"
    ).length;


  const deadEndCount =
    [
      ...streamById.values()
    ].filter(
      stream =>
        stream.deadEnd
    ).length;


  return {
    totals: {
      filesScanned:
        files.length,

      javascriptFiles:
        javascriptFiles.length,

      streamCount:
        streamById.size,

      majorRiverCount:
        rivers.length,

      participatingSymbols:
        participatingSymbols.size,

      fileDependencyEdges:
        dependencyEdgeCount,

      dependencyJoins:
        [
          ...streamById.values()
        ].reduce(
          (
            total,
            stream
          ) =>
            total +
            stream.dependencyJoinCount,
          0
        ),

      deadEnds:
        deadEndCount,

      cycles:
        cycleCount,

      missingRequiredProviders:
        missingProviderCount
    },

    outlets:
      outletFiles.map(
        relativePath
      ),

    rivers
  };
}


function printDependencyWatershed(
  dependencyFlow
) {
  const totals =
    dependencyFlow.totals;


  console.log(
    ""
  );


  console.log(
    "Frame Conn dependency watershed:"
  );


  console.log(
    `${totals.streamCount} streams | ${totals.majorRiverCount} major rivers | ${totals.participatingSymbols} participating symbols | ${totals.dependencyJoins} stream joins`
  );


  console.log(
    `${totals.deadEnds} dead ends | ${totals.cycles} cycles | ${totals.missingRequiredProviders} missing required providers`
  );


  for (
    const river
    of dependencyFlow.rivers
  ) {
    console.log(
      ""
    );


    console.log(
      `${river.label}: ${river.streamCount} streams | ${river.fileCount} files | ${river.symbolCount} symbols | ${river.dependencyJoinCount} joins`
    );


    console.log(
      `  convergence: ${river.convergence} -> ${river.outlet ?? "no declared outlet"}`
    );


    for (
      const stream
      of river.streams
    ) {
      const upstream =
        stream.upstreamStreams.length >
        0
          ? stream.upstreamStreams.join(
              ", "
            )
          : "source";


      const downstream =
        stream.downstreamStreams.length >
        0
          ? stream.downstreamStreams.join(
              ", "
            )
          : stream.convergence;


      console.log(
        `  ${stream.id}: ${stream.fileCount} files | ${stream.symbolCount} symbols | ${upstream} -> ${downstream}${stream.status === "healthy" ? "" : ` | ${stream.status.toUpperCase()}`}`
      );


      if (
        stream.status !==
        "healthy"
      ) {
        for (
          const problem
          of stream.problems
        ) {
          console.log(
            `    ! ${problem.code}${problem.file ? ` @ ${problem.file}` : ""}: ${problem.message}`
          );
        }
      }
    }
  }
}


/* ============================================================
   Report construction
   ============================================================ */

function countBySeverity(
  severity
) {
  return (
    findings.filter(
      finding =>
        finding.severity ===
        severity
    ).length
  );
}


function buildReport({
  files,
  javascriptFiles,
  cssFiles,
  features,
  featureGraph,
  dependencyFlow,
  manifest
}) {
  const errors =
    countBySeverity(
      "error"
    );


  const warnings =
    countBySeverity(
      "warning"
    );


  const info =
    countBySeverity(
      "info"
    );


  return {
    audit: {
      name:
        "Frame Conn Repository Audit",

      scriptVersion:
        SCRIPT_VERSION,

      generatedAt:
        new Date()
          .toISOString(),

      repositoryRoot:
        normalizeSlashes(
          REPOSITORY_ROOT
        ),

      result:
        errors > 0
          ? "failed"
          : warnings > 0
            ? "warning"
            : "passed"
    },


    summary: {
      filesScanned:
        files.length,

      javascriptFiles:
        javascriptFiles.length,

      cssFiles:
        cssFiles.length,

      featureDeclarations:
        features.length,

      featureIds:
        [
          ...featureGraph.byId.keys()
        ],

      capabilities:
        [
          ...featureGraph
            .capabilityProviders
            .keys()
        ].sort(),

      findings:
        findings.length,

      errors,

      warnings,

      info,

      dependencyStreams:
        dependencyFlow.totals.streamCount,

      majorRivers:
        dependencyFlow.totals.majorRiverCount,

      participatingSymbols:
        dependencyFlow.totals.participatingSymbols,

      dependencyJoins:
        dependencyFlow.totals.dependencyJoins,

      deadEnds:
        dependencyFlow.totals.deadEnds,

      cycles:
        dependencyFlow.totals.cycles,

      missingRequiredProviders:
        dependencyFlow.totals.missingRequiredProviders
    },


    dependencyFlow,


    manifest: manifest
      ? {
          id:
            manifest.id ??
            null,

          title:
            manifest.title ??
            null,

          version:
            manifest.version ??
            null,

          compatibility:
            manifest.compatibility ??
            null,

          esmodules:
            manifest.esmodules ??
            [],

          styles:
            manifest.styles ??
            []
        }
      : null,


    features:
      features.map(
        feature => ({
          file:
            relativePath(
              feature.file
            ),

          line:
            feature.line,

          id:
            feature.id,

          domain:
            feature.domain,

          provides:
            feature.provides,

          dependsOn:
            feature.dependsOn,

          optionalDependsOn:
            feature.optionalDependsOn
        })
      ),


    findings:
      findings
        .slice()
        .sort(
          (
            left,
            right
          ) => {
            const rank = {
              error:
                0,

              warning:
                1,

              info:
                2
            };


            return (
              rank[
                left.severity
              ] -
              rank[
                right.severity
              ]
            );
          }
        )
  };
}


/* ============================================================
   Audit execution
   ============================================================ */

function runAudit() {
  console.log(
    "Frame Conn repository audit starting..."
  );


  console.log(
    `Repository: ${REPOSITORY_ROOT}`
  );


  const files =
    collectRepositoryFiles();


  const javascriptFiles =
    files.filter(
      file =>
        JAVASCRIPT_EXTENSIONS.has(
          path.extname(
            file
          ).toLowerCase()
        )
    );


  const cssFiles =
    files.filter(
      file =>
        path.extname(
          file
        ).toLowerCase() ===
        ".css"
    );


  const textByFile =
    new Map();


  for (
    const file
    of files
  ) {
    const text =
      safeReadText(
        file
      );


    if (
      text !==
      null
    ) {
      textByFile.set(
        file,
        text
      );
    }
  }


  auditJsonFiles(
    files
  );


  const dependencyGraph =
    auditJavaScriptImports(
      javascriptFiles,
      textByFile
    );


  auditCssImports(
    cssFiles,
    textByFile
  );


  const featureDeclarationExcludedFiles =
    new Set([
      "scripts/feature-contract.js",
      "dev_scripts/player_features/repo-audit.mjs"
    ]);


  const features =
    javascriptFiles
      .filter(
        file =>
          !featureDeclarationExcludedFiles.has(
            relativePath(
              file
            )
          )
      )
      .flatMap(
        file =>
          extractFeatureDeclarations(
            file,
            textByFile.get(
              file
            ) ??
            ""
          )
      );


  const featureGraph =
    auditFeatureGraph(
      features
    );


  auditRuntimeFeatureRegistration(
    javascriptFiles,
    textByFile,
    features
  );


  auditUiFeatureRegistration(
    javascriptFiles,
    textByFile,
    features
  );


  const manifest =
    auditModuleManifest();


  auditMetadataPaths(
    javascriptFiles,
    textByFile
  );


  auditCircularDependencies(
    dependencyGraph
  );


  auditDuplicateBasenames(
    files
  );


  const dependencyFlow =
    buildDependencyWatershed({
      files,
      javascriptFiles,
      textByFile,
      dependencyGraph,
      features,
      featureGraph,
      manifest
    });


  const report =
    buildReport({
      files,
      javascriptFiles,
      cssFiles,
      features,
      featureGraph,
      dependencyFlow,
      manifest
    });


  printDependencyWatershed(
    dependencyFlow
  );


  fs.mkdirSync(
    path.dirname(
      OUTPUT_FILE
    ),
    {
      recursive:
        true
    }
  );


  fs.writeFileSync(
    OUTPUT_FILE,
    `${JSON.stringify(
      report,
      null,
      2
    )}\n`,
    "utf8"
  );


  console.log(
    ""
  );


  console.log(
    "Frame Conn repository audit complete."
  );


  console.log(
    `Result:   ${report.audit.result.toUpperCase()}`
  );


  console.log(
    `Errors:   ${report.summary.errors}`
  );


  console.log(
    `Warnings: ${report.summary.warnings}`
  );


  console.log(
    `Info:     ${report.summary.info}`
  );


  console.log(
    `Report:   ${OUTPUT_FILE}`
  );


  /*
   * Exit non-zero only for actual errors.
   *
   * This allows the script to be used in CI later while keeping
   * warnings informational during development.
   */
  if (
    report.summary.errors >
    0
  ) {
    process.exitCode =
      1;
  }
}


/* ============================================================
   Entry point
   ============================================================ */

runAudit();
