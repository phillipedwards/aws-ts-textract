import * as aws from "@pulumi/aws";

import { lambaRole, ObjectEvent } from "./common";
import { buildStartLambda, buildResultsLambda } from "./state-lambda";
import { buildStateMachine } from "./state-machine";

const region = aws.config.requireRegion();

// IAM role for lambdas which includes s3 PutObject and logs permissions and step functions access
// NOTE: this role has too many permissions for a production-like environment but suits this example
const lambdaRole = lambaRole();

// lambda function to trigger the textract document analysis endpoint
const startLambda = buildStartLambda(lambdaRole);

// lambda function to check the job status of textract's analysis and export to s3 once complete
const resultsLambda = buildResultsLambda(lambdaRole);

// build the step functions state machine that will orchestrate the workflow for 
// triggering textract's document analysis, retieving the results, and saving the results to s3.
const stateMachine = buildStateMachine(region, startLambda.arn, resultsLambda.arn);

// lambda function to receive the s3 PUT notification and trigger the state machine workflow.
const bucketEventLambda = new aws.lambda.CallbackFunction<aws.s3.BucketEvent, void>("eventHandlerLambda", {
    role: lambdaRole,
    environment: {
        variables: {
            STATE_MACHINE_ARN: stateMachine.arn
        }
    },
    callback: async event => {
        const aws = await import("aws-sdk");
        const uuid = await import("uuid");
        const stepFunction = new aws.StepFunctions();

        try {
            if (!event.Records) {
                console.log("No records to process...");
                return;
            }
    
            console.log(`Processing ${event.Records.length} records`);
    
            for (const record of event.Records) {

                console.log(`Object w/ key ${record.s3.object.key} uploaded to bucket ${record.s3.bucket.name}`);
    
                const payload: ObjectEvent = {
                    bucket: record.s3.bucket.name,
                    id: uuid.v4(),
                    key: record.s3.object.key
                };
                
                const params = {
                    stateMachineArn: process.env.STATE_MACHINE_ARN || "",
                    input: JSON.stringify(payload),
                    name: uuid.v4()
                };
    
                console.log(`Invoking StepFunctions arn ${params.stateMachineArn} w/ id ${params.name}`);
    
                const response = await stepFunction.startExecution(params).promise();

                console.log(`Textract response::${JSON.stringify(response)}`);

                if (response.$response.error) {
                    // log it and bail
                    console.log(`Unable to successfully queue step functions for ${record.s3.object.key} due to ${response.$response.error}`);
                    return;
                }
            }
        } catch (error) {
            console.log(`Error encountered::${JSON.stringify(error)}`);
            throw error;
        }
    }
});

const bucket = new aws.s3.Bucket("docStorage");

// limit to trigger this process on PDFs only
// the bucket will also contain the output JSON files from textract
bucket.onObjectCreated("eventSubscription", bucketEventLambda, { filterSuffix: ".pdf"});

export const bucketName = bucket.bucket;
export const stateMachineArn = stateMachine.arn
