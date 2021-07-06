import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

/* 
    StepFunctions state machine definition
    Simple workflow: start -> sleep -> getResults -> if jobs done then 
                                                            goto end 
                                                     else 
                                                            goto sleep.                                                             
*/
const getStateDefinition = (startArn: pulumi.Output<string>, resultsArn: pulumi.Output<string>): any => {
    return pulumi.all([startArn, resultsArn]).apply(([start, result]) => JSON.stringify(
        {
            "StartAt": "Initialize",
            "States": {
                "Initialize": {
                    "Type": "Task",
                    "Resource": start,
                    "Next": "Sleep"
                },
                "Sleep": {
                    "Type": "Wait",
                    "Seconds": 5,
                    "Next": "ProcessResults"
                },
                "ProcessResults": {
                    "Type": "Task",
                    "Resource": result,
                    "Next": "IsJobDone"
                },
                "IsJobDone": {
                    "Type": "Choice",
                    "Choices": [{
                        "Variable": "$.textractStatus",
                        "StringEquals": "SUCCEEDED",
                        "Next": "Success"
                    }, {
                        "Variable": "$.textractStatus",
                        "StringEquals": "IN_PROGRESS",
                        "Next": "Sleep"
                    }],
                    "Default": "Failure"
                },
                "Success": {
                    "Type": "Succeed"
                },
                "Failure": {
                    "Type": "Fail"
                }
            }
        }
    ));
}

// Construct the new state machine and return it to the caller
export const buildStateMachine = (region: string, startLambdaArn: pulumi.Output<string>, resultsLambdaArn: pulumi.Output<string>): aws.sfn.StateMachine => {
    const stateRole = new aws.iam.Role("stateRole", {
        assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: `states.${region}.amazonaws.com` }),
    });
    
    new aws.iam.RolePolicy("stateRolePolicy", {
        role: stateRole.id,
        policy: {
            Version: "2012-10-17",
            Statement: [{
                Effect: "Allow",
                Action: [
                    "lambda:InvokeFunction",
                ],
                Resource: "*",
            }],
        },
    });
    
    return new aws.sfn.StateMachine("analysisMachine", {
        roleArn: stateRole.arn,
        definition: getStateDefinition(startLambdaArn, resultsLambdaArn)
    });
}
