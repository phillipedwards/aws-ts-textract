import * as aws from "@pulumi/aws";
import { ObjectEvent } from "./common";

// Simple lambda to begin the state machine. Trigger texttract with s3 doc location -> set job status to "IN_PROGRESS" -> exit
export const buildStartLambda = (role: aws.iam.Role): aws.lambda.CallbackFunction<TextEvent, void> => {
    return new aws.lambda.CallbackFunction<ObjectEvent, ObjectEvent>("startAnalysis", {
        role: role,
        callback: async event => {
            const aws = await import("aws-sdk");
            const client = new aws.Textract();

            console.log(`EVENT::${JSON.stringify(event)}`);

            const payload = {
                DocumentLocation: {
                    "S3Object": {
                        "Bucket": event.bucket,
                        "Name": event.key
                    }
                },
                FeatureTypes: ["TABLES", "FORMS"]
            };

            console.log(`Analysis payload::${JSON.stringify(payload)}`);

            const response = await client.startDocumentAnalysis(payload).promise();

            console.log(`Job Id: ${response.JobId} started for object ${event.key}`);

            event.jobId = response.JobId!
            event.textractStatus = "IN_PROGRESS";

            return event;
        }
    });
}

// Process the results from the completed textract job. Lambda will wait until textract has fully finished, before processing results
// once results are available, the raw textract response will be placed in s3 for further processing.
export const buildResultsLambda = (role: aws.iam.Role): aws.lambda.CallbackFunction<TextEvent, void> => {
    return new aws.lambda.CallbackFunction<ObjectEvent, ObjectEvent>("getResults", {
        role: role,
        callback: async event => {
            const AWS = await import("aws-sdk");
            const client = new AWS.Textract();
            const s3Client = new AWS.S3();

            // local function allows us to retrieve doc analysis from textract api w/ or w/o "nextToken"
            async function getTextractResults(client: AWS.Textract, jobId: string, nextToken: string) {
                console.log(`Retrieve results for textract job id ${jobId}`);

                let payload: any;
                if (nextToken) {
                    payload = {
                        JobId: jobId,
                        NextToken: nextToken
                    };
                } else {
                    payload = {
                        JobId: jobId
                    };
                }

                console.log(`Analysis Payload::${JSON.stringify(payload)}`);

                return await client.getDocumentAnalysis(payload).promise();
            };

            let results = await getTextractResults(client, event.jobId!, "");

            console.log(`Textract Job Status::${JSON.stringify(results)}`)

            // set job status in persisted payload event
            event.textractStatus = results.JobStatus;

            // enter a sleep cycle until our job is complete
            if (event.textractStatus !== "SUCCEEDED") {

                console.log(`Job Id ${event.jobId} w/ status ${event.textractStatus} still executing`);

                return event;
            }

            let pageCounter = 0;
            while (true) {
                pageCounter++;

                // using a paged approach, insert documents into s3 for downstream processing
                const newKey = `${event.key}_raw_${pageCounter}.json`;
                const s3Params = {
                    Bucket: event.bucket,
                    Key: newKey,
                    Body: JSON.stringify(results),
                    ContentType: "application/json"
                };

                await s3Client.putObject(s3Params).promise();

                console.log(`Successfully saved page ${pageCounter} results to s3://${event.bucket}/${newKey}`);

                // continue processing documents until we exhaust all available textract data
                if (!results.NextToken) {
                    break;
                }

                results = await getTextractResults(client, event.jobId!, results.NextToken);
            }

            console.log(`Exiting getResults lambda w/ job status of ${event.textractStatus}`);

            // at this point, our process should be fully complete and state machine should exit.
            return event;
        }
    });
}