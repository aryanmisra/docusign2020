const { now } = require("moment");

const path = require("path"),
  fs = require("fs-extra"),
  docusign = require("docusign-esign"),
  validator = require("validator"),
  dsConfig = require("../config/index.js").config;
const dataSharingEmbeddedSigning = exports,
  eg = "dataSharing", // This example reference.
  mustAuthenticate = "/ds/mustAuthenticate",
  login = "/ds/login",
  minimumBufferMin = 3,
  signerClientId = 1000, // The id of the signer within this application.
  demoDocsPath = path.resolve(__dirname, "../documents"),
  pdf1File = "Justification_for_Remote_Audit.pdf",
  dsReturnUrl = dsConfig.appUrl + "/ds-return",
  dsPingUrl = dsConfig.appUrl + "/"; // Url that will be pinged by the DocuSign Signing Ceremony via Ajax
var orgName = "Test";

/**
 * Create the envelope, the Signing Ceremony, and then redirect to the Signing Ceremony
 * @param {object} req Request obj
 * @param {object} res Response obj
 */
dataSharingEmbeddedSigning.createController = async (req, res) => {
  // Step 1. Check the token
  // At this point we should have a good token. But we
  // double-check here to enable a better UX to the user.
  //console.log("createcontroller");
  let tokenOK = req.dsAuth.checkToken(minimumBufferMin);
  if (!tokenOK) {
    req.flash("info", "Sorry, you need to re-authenticate.");
    // We could store the parameters of the requested operation
    // so it could be restarted automatically.
    // But since it should be rare to have a token issue here,
    // we'll make the user re-enter the form data after
    // authentication.
    req.dsAuth.setEg(req, eg);
    res.redirect(login);
  }

  // Step 2. Call the worker method
  let body = req.body,
    // Additional data validation might also be appropriate
    signerEmail = validator.escape(body.signerEmail),
    signerName = validator.escape(body.signerName),
    envelopeArgs = {
      signerEmail: signerEmail,
      signerName: signerName,
      signerClientId: signerClientId,
      dsReturnUrl: dsReturnUrl,
      dsPingUrl: dsPingUrl,
    },
    args = {
      accessToken: req.user.accessToken,
      basePath: req.session.basePath,
      accountId: req.session.accountId,
      envelopeArgs: envelopeArgs,
    },
    results = null;
  try {
    results = await dataSharingEmbeddedSigning.worker(args);
  } catch (error) {
    let errorBody = error && error.response && error.response.body,
      // we can pull the DocuSign error code and message from the response body
      errorCode = errorBody && errorBody.errorCode,
      errorMessage = errorBody && errorBody.message;
    // In production, may want to provide customized error messages and
    // remediation advice to the user.
    res.render("pages/error", {
      err: error,
      errorCode: errorCode,
      errorMessage: errorMessage,
    });
  }
  if (results) {
    // Redirect the user to the Signing Ceremony
    // Don't use an iFrame!
    // State can be stored/recovered using the framework's session or a
    // query parameter on the returnUrl (see the makeRecipientViewRequest method)
    res.redirect(results.redirectUrl);
  }
};

/**
 * This function does the work of creating the envelope and the
 * embedded Signing Ceremony
 * @param {object} args
 */
// ***DS.snippet.0.start
dataSharingEmbeddedSigning.worker = async (args) => {
  // Data for this method
  // args.basePath
  // args.accessToken
  // args.accountId

  let dsApiClient = new docusign.ApiClient();
  dsApiClient.setBasePath(args.basePath);
  dsApiClient.addDefaultHeader("Authorization", "Bearer " + args.accessToken);
  let envelopesApi = new docusign.EnvelopesApi(dsApiClient),
    results = null;

  // Step 1. Make the envelope request body
  let envelope = makeEnvelope(args.envelopeArgs);

  // Step 2. call Envelopes::create API method
  // Exceptions will be caught by the calling function
  results = await envelopesApi.createEnvelope(args.accountId, {
    envelopeDefinition: envelope,
  });

  let envelopeId = results.envelopeId;
  //console.log(`Envelope was created. EnvelopeId ${envelopeId}`);

  // Step 3. create the recipient view, the Signing Ceremony
  let viewRequest = makeRecipientViewRequest(args.envelopeArgs);
  // Call the CreateRecipientView API
  // Exceptions will be caught by the calling function
  results = await envelopesApi.createRecipientView(args.accountId, envelopeId, {
    recipientViewRequest: viewRequest,
  });

  return { envelopeId: envelopeId, redirectUrl: results.url };
};

/**
 * Creates envelope
 * @function
 * @param {Object} args parameters for the envelope:
 * @returns {Envelope} An envelope definition
 * @private
 */
function makeEnvelope(args) {
  // Data for this method
  // args.signerEmail
  // args.signerName
  // args.signerClientId
  // demoDocsPath (module constant)
  // pdf1File (module constant)

  // document 1 (pdf) has tag /sn1/
  //
  // The envelope has one recipients.
  // recipient 1 - signer

  let docPdfBytes;
  // read file from a local directory
  // The read could raise an exception if the file is not available!
  docPdfBytes = fs.readFileSync(path.resolve(demoDocsPath, pdf1File));

  // create the envelope definition
  let env = new docusign.EnvelopeDefinition();
  env.emailSubject = "Please sign this document";

  // add the documents
  let doc1 = new docusign.Document(),
    doc1b64 = Buffer.from(docPdfBytes).toString("base64");
  doc1.documentBase64 = doc1b64;
  doc1.fileExtension = "pdf";
  doc1.name = "Data Sharing Confidentiality Agreement";
  doc1.documentId = "3";

  // The order in the docs array determines the order in the envelope
  env.documents = [doc1];

  // Create a signer recipient to sign the document, identified by name and email
  // We set the clientUserId to enable embedded signing for the recipient
  // We're setting the parameters via the object creation
  let signer1 = docusign.Signer.constructFromObject({
    email: args.signerEmail,
    name: args.signerName,
    clientUserId: args.signerClientId,
    recipientId: 1,
  });

  // Create signHere fields (also known as tabs) on the documents,
  // We're using anchor (autoPlace) positioning
  //
  // The DocuSign platform seaches throughout your envelope's
  // documents for matching anchor strings.
  
  let check1 = docusign.Checkbox.constructFromObject({
    documentId: "3",
    pageNumber: "1",
    xPosition: "63",
    yPosition: "217",
    required: "true",
    selected: false,
    locked: "false",
    tabId: "c1",
    tabLabel: "Checkbox"
  });
  let check2 = docusign.Checkbox.constructFromObject({
    documentId: "3",
    pageNumber: "1",
    xPosition: "63",
    yPosition: "291",
    required: "true",
    selected: false,
    locked: "false",
    tabId: "c2",
    tabLabel: "Checkbox"
  });

  let check3 = docusign.Checkbox.constructFromObject({
    documentId: "3",
    pageNumber: "1",
    xPosition: "63",
    yPosition: "345",
    required: "true",
    selected: false,
    locked: "false",
    tabId: "c3",
    tabLabel: "Checkbox"
  });

  let check4 = docusign.Checkbox.constructFromObject({
    documentId: "3",
    pageNumber: "1",
    xPosition: "63",
    yPosition: "400",
    required: "true",
    selected: false,
    locked: "false",
    tabId: "c4",
    tabLabel: "Checkbox"
  });

  let organization = docusign.Text.constructFromObject({
    documentId: "3",
    pageNumber: "1",
    xPosition: "165",
    yPosition: "562",
    font: "helvetica",
    fontSize: "size14",
    tabLabel: "Company",
    height: "23",
    width: "84",
    required: "true",
    bold: "true",
    value: orgName,
    locked: "false",
    tabId: "name",
  });

  let fullName = docusign.Text.constructFromObject({
    documentId: "3",
    pageNumber: "1",
    xPosition: "200",
    yPosition: "595",
    font: "helvetica",
    fontSize: "size14",
    tabLabel: "Name",
    height: "23",
    width: "84",
    required: "true",
    bold: "true",
    value: args.signerName,
    locked: "false",
    tabId: "name",
  });

  const signHere = docusign.SignHere.constructFromObject({
    documentId: "3",
    pageNumber: "1",
    recipientId: "1",
    tabLabel: "SignHereTab",
    xPosition: "150",
    yPosition: "620",
  });

  let currentDate = new Date();

  let date =
    currentDate.getFullYear() +
    "/" +
    (currentDate.getMonth() + 1) +
    "/" +
    currentDate.getDate();

  let dateTab = docusign.Text.constructFromObject({
    documentId: "3",
    pageNumber: "1",
    xPosition: "100",
    yPosition: "533",
    font: "helvetica",
    fontSize: "size14",
    tabLabel: "Date",
    height: "23",
    width: "84",
    required: "true",
    bold: "true",
    value: date,
    locked: "true",
    tabId: "date",
  });

  signer1.tabs = docusign.Tabs.constructFromObject({
    signHereTabs: [signHere],
    textTabs: [organization, fullName, dateTab],
    checkboxTabs: [check1,check2,check3,check4],
  });
  // Add the recipient to the envelope object
  let recipients = docusign.Recipients.constructFromObject({
    signers: [signer1],
  });
  env.recipients = recipients;

  // Request that the envelope be sent by setting |status| to "sent".
  // To request that the envelope be created as a draft, set to "created"
  env.status = "sent";

  return env;
}

function makeRecipientViewRequest(args) {
  // Data for this method
  // args.dsReturnUrl
  // args.signerEmail
  // args.signerName
  // args.signerClientId
  // args.dsPingUrl

  let viewRequest = new docusign.RecipientViewRequest();

  // Set the url where you want the recipient to go once they are done signing
  // should typically be a callback route somewhere in your app.
  // The query parameter is included as an example of how
  // to save/recover state information during the redirect to
  // the DocuSign signing ceremony. It's usually better to use
  // the session mechanism of your web framework. Query parameters
  // can be changed/spoofed very easily.
  viewRequest.returnUrl = args.dsReturnUrl + "?state=123";

  // How has your app authenticated the user? In addition to your app's
  // authentication, you can include authenticate steps from DocuSign.
  // Eg, SMS authentication
  viewRequest.authenticationMethod = "none";

  // Recipient information must match embedded recipient info
  // we used to create the envelope.
  viewRequest.email = args.signerEmail;
  viewRequest.userName = args.signerName;
  viewRequest.clientUserId = args.signerClientId;

  // DocuSign recommends that you redirect to DocuSign for the
  // Signing Ceremony. There are multiple ways to save state.
  // To maintain your application's session, use the pingUrl
  // parameter. It causes the DocuSign Signing Ceremony web page
  // (not the DocuSign server) to send pings via AJAX to your
  // app,
  viewRequest.pingFrequency = 600; // seconds
  // NOTE: The pings will only be sent if the pingUrl is an https address
  viewRequest.pingUrl = args.dsPingUrl; // optional setting

  return viewRequest;
}
// ***DS.snippet.0.end

/**
 * Form page for this application
 */
dataSharingEmbeddedSigning.getController = (req, res) => {
  orgName = req.query.orgName;
  // Check that the authentication token is ok with a long buffer time.
  // If needed, now is the best time to ask the user to authenticate
  // since they have not yet entered any information into the form.
  let tokenOK = req.dsAuth.checkToken();
  if (tokenOK) {
    res.render("pages/examples/dataSharingEmbeddedSigning", {
      eg: eg,
      csrfToken: req.csrfToken(),
      title: "Signing Ceremony",
      sourceFile: path.basename(__filename),
      sourceUrl: dsConfig.githubExampleUrl + path.basename(__filename),
      documentation: dsConfig.documentation + eg,
      showDoc: dsConfig.documentation,
    });
  } else {
    // Save the current operation so it will be resumed after authentication
    req.dsAuth.setEg(req, eg);
    res.redirect(login);
  }
};
