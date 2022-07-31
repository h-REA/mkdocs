import assert from 'assert'
import { paramCase, capitalCase, pascalCase } from 'change-case'
import fs from 'fs'
import path from 'path'
import ts from 'typescript'

import { VfModule, DEFAULT_VF_MODULES, hreaExtensionSchemas } from '@valueflows/vf-graphql-holochain'
import { buildSchema } from '@valueflows/vf-graphql'

// extend the base vf-graphql schema with one
// or more holochain specific schema extensions.
// add more here if more are added.
const overriddenExtensionSchemas = [hreaExtensionSchemas.associateMyAgentExtension]
const schema = buildSchema(DEFAULT_VF_MODULES, overriddenExtensionSchemas)
// debugger
// process.exit()


const pathToReferenceDocsFolder =
  '../graphql-developer-docs/reference/graphql-api-reference'

const pathToVfGraphqlHolochain = '../hrea/modules/vf-graphql-holochain'
const pathToMutations = 'mutations'
const pathToQueries = 'queries'
const pathToResolvers = 'resolvers'

const queries = {}
const mutations = {}

// which classes are enabled via which module
// the names are specified in a casing which suits how the names of the related
// files in vf-graphql-holochain file folders appear
const CLASSES_PER_MODULE = {
  [VfModule.Action]: ['action'],
  [VfModule.ProcessSpecification]: ['processSpecification'],
  [VfModule.ResourceSpecification]: ['resourceSpecification'],
  [VfModule.Measurement]: ['unit'],
  [VfModule.Agent]: ['agent'],
  [VfModule.Agreement]: ['agreement'],
  [VfModule.Observation]: ['economicEvent', 'economicResource'],
  [VfModule.Process]: ['process'],
  // note 'proposedTo' also requires 'agent'
  [VfModule.Proposal]: ['proposal', 'proposedIntent', 'proposedTo'],
  [VfModule.Plan]: ['plan'],
  [VfModule.Fulfillment]: ['fulfillment'],
  [VfModule.Intent]: ['intent'],
  [VfModule.Commitment]: ['commitment'],
  [VfModule.Satisfaction]: ['satisfaction'],
  [VfModule.Util]: [],
  [VfModule.Pagination]: [],
}

const collectExportsPerFile = (pathToFolder, collectionObj) => {
  const filesInFolder = fs.readdirSync(
    path.join(pathToVfGraphqlHolochain, pathToFolder)
  )
  // goal here is to check the default export for each file
  // and to see which of its mutations are implemented yet
  for (let fileName of filesInFolder) {
    const fullpath = path.join(pathToVfGraphqlHolochain, pathToFolder, fileName)
    // skip over index.ts, only do the others
    if (fileName === 'index.ts') continue
    // Parse a file
    const sourceFile = ts.createSourceFile(
      fileName,
      fs.readFileSync(fullpath, { encoding: 'utf-8' }),
      ts.ScriptTarget.ES2022
    )

    // Find the default export
    const defaultExport = sourceFile.statements.find((statement) => {
      return ts.isExportAssignment(statement)
    })

    if (defaultExport) {
      // take the last statement
      // which should be the return value
      const returnStatement =
        defaultExport.expression.body.statements[
          defaultExport.expression.body.statements.length - 1
        ]
      assert(
        ts.isReturnStatement(returnStatement),
        'last statement of the default export should be a return statement'
      )

      const exportNames = returnStatement.expression.properties.map((prop) => {
        // NAME
        const name = prop.name.escapedText

        // IMPLEMENTATION STATUS
        let implementation
        if (prop.initializer) {
          // in some cases the function body is defined inline
          implementation = prop
        } else {
          //  in some cases the function body is defined separately above
          const statement = defaultExport.expression.body.statements.find(
            (statement) => {
              return (
                ts.isVariableStatement(statement) &&
                statement.declarationList.declarations[0].name.escapedText ===
                  name
              )
            }
          )
          if (statement) {
            implementation = statement.declarationList.declarations[0]
          }
        }

        // true means 'implemented'
        const implementationStatus = implementation
          ? // catches ones such as `injectTypename`
            ts.isCallExpression(implementation.initializer) ||
            // catches ones that are directly functions, and that do not have `throw` statements
            !ts.isThrowStatement(implementation.initializer.body.statements[0])
          : false

        // description
        const queryOrMutation = pathToFolder === 'mutations' ? 'Mutation' : 'Query'
        const vfGraphqlDef = schema._typeMap[queryOrMutation].astNode.fields.find((field) => {
          return field.name.value === name
        })
        const description = vfGraphqlDef && vfGraphqlDef.description ? vfGraphqlDef.description.value : ''

        return {
          name,
          description,
          implementationStatus: implementationStatus
            ? 'Implemented'
            : 'Unimplemented',
        }
      })

      // we now have the filename
      // and the named exports
      // all that we now need are whether or not each named export is 'implemented' or not
      // which we can tell by checking its definition

      // once we have all of that, we can write the outputs
      // to the related module file
      collectionObj[fileName.replace('.ts', '')] = exportNames
    }
  }
}

collectExportsPerFile(pathToMutations, mutations)
collectExportsPerFile(pathToQueries, queries)

// aggregate the queries and mutations for a given module into one object
// per module
const allModulesForDocumentation = DEFAULT_VF_MODULES.map((module) => {
  let queriesForModule = []
  let mutationsForModule = []
  CLASSES_PER_MODULE[module].forEach((className) => {
    queriesForModule = queriesForModule.concat(queries[className] || [])
    mutationsForModule = mutationsForModule.concat(mutations[className] || [])
  })

  return {
    moduleName: module, // underscore casing
    queries: queriesForModule,
    mutations: mutationsForModule,
  }
})

// write to the documentation
allModulesForDocumentation.forEach((moduleForDocumentation) => {
  // don't do Util or Pagination
  if (moduleForDocumentation.moduleName === VfModule.Util || moduleForDocumentation.moduleName === VfModule.Pagination) {
    return
  }
  // files are markdown, with "process-specification" style 'param case'
  const moduleNameParamCase =
    paramCase(moduleForDocumentation.moduleName) + '.md'
  const pathToDocsFileForModule = path.join(
    pathToReferenceDocsFolder,
    moduleNameParamCase
  )

  let stringToWrite = ''

  // heading
  stringToWrite += `# ${capitalCase(moduleForDocumentation.moduleName)}\n\n`

  // key classes
  stringToWrite += `## Classes\n\n`
  CLASSES_PER_MODULE[moduleForDocumentation.moduleName].forEach((className) => {
    // e.g. ProcessSpecification
    const classNamePascal = pascalCase(className)
    const documentationDescription = schema._typeMap[classNamePascal].description
    stringToWrite += `### \`${classNamePascal}\`\n\n`
    stringToWrite += `${documentationDescription}\n\n`
    // stringToWrite += `> Status: ${query.implementationStatus}\n\n`
  })

  // queries
  stringToWrite += `## Queries\n\n`
  moduleForDocumentation.queries.forEach((query) => {
    stringToWrite += `### \`${query.name}\`\n`
    stringToWrite += `${query.description}\n`
    stringToWrite += `> Status: ${query.implementationStatus}\n\n`
  })
  
  // mutations
  stringToWrite += `## Mutations\n\n`
  moduleForDocumentation.mutations.forEach((mutation) => {
    stringToWrite += `### \`${mutation.name}\`\n`
    stringToWrite += `${mutation.description}\n`
    stringToWrite += `> Status: ${mutation.implementationStatus}\n\n`
  })

  fs.writeFileSync(pathToDocsFileForModule, stringToWrite)
})
