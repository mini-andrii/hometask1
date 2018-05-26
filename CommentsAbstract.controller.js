sap.ui.define([
		"credins/reuse/controller/BaseController",
		"credins/reuse/model/utils",
		"credins/reuse/model/utilities/Radio",
		"credins/reuse/dependents/ContactCard",
		"sap/ui/model/json/JSONModel",
		"sap/ui/model/Sorter",
		"sap/ui/core/ListItem",
		"sap/m/List",
		"sap/m/FeedListItem",
		"credins/reuse/model/consts/ModuleMode",
		"credins/reuse/modules/comments/CommentsODATAMixin",
		"credins/reuse/modules/comments/CommentsJSONMixin"
	], function (BaseController, rutils, Radio, ContactCard, JSONModel, Sorter, ListItem, List, FeedListItem, ModuleMode, CommentsODATAMixin, CommentsJSONMixin) {
		"use strict";

		/**
		 * Common functionality for posting comments
		 */
		var COMMENTS_LIST_ID		= "CommentsList";
		var COMMENTS_LAYOUT_ID		= "CommentsLayout";
		var PARENT_SEARCH_INTERVAL	= 100;
		var PARENT_SEARCH_TIMEOUT	= 20000;

		// global module variable to control over the state of the i18n enhancing. The point is that it should be done
		// only once on the very initial module load
		var bIsi18nEnhanced = false;

		return BaseController.extend("credins.reuse.modules.comments.CommentsAbstract", {
			/**
			 * Controller initialize method.
			 */
			onInit: function () {
				BaseController.prototype.onInit.apply(this, arguments);

				this._setDefaultParameters();

				// synchronize the edit state of the page with the edit state of the module
				this._initModelsSynchronizing("appView", ["/edit"]);

				// enhance i18n if needed
				if (!bIsi18nEnhanced) {
					var sModulePath = jQuery.sap.getModulePath("credins/reuse");
					var si18nModulePath = sModulePath + "/modules/comments/comments_i18n.properties";

					this.getOwnerComponent().enhanceI18n(si18nModulePath);

					bIsi18nEnhanced = true;
				}
			},

			/**
			 * Default parameters setter. They should be a part of the object instance itself (but not of a prototype).
			 * @private
			 */
			_setDefaultParameters: function () {
				this.oParameters = {};

				this.oCommentsObjectConfig = {
					sender	: "Author",
					date	: "Date",
					message	: "Comment"
				};

				this.iParentContextSearchInterval = null;

				this.sModelName = null;

				this.sCommentsBindingPath = "";
			},

			onAfterRendering: function () {
				var that = this;

				this.oParameters = jQuery.extend({
					visibility: {enabled: false},
					parentKeyProperty: "GUID",
					parentKeyReferenceProperty: "GUID00"
				}, this.getView().getParent().data("moduleConfig"));

				if (!this.oParameters.modelName) {
					this.oParameters.modelName = undefined;
				}

				var oCommentType = this.byId("CommentType");

				// Bind comment type control by app source
				if (!oCommentType.getBinding("items")) {
					this.bindCommentType();
				} else {
					oCommentType.setSelectedItem(oCommentType.getItems()[0]);
				}

				if (typeof this.oParameters.useCommentType === "undefined") {
					this.oParameters.useCommentType = false;
				}

				this.getView().setModel(new JSONModel(this.oParameters), "parameters");

				this._injectMixin();

				// wait until the parent binding context is set, only once it's a case, proceed with module init
				this._whenTheParentContextIsSet().then(function () {
					that.__init();
				});
			},

			/**
			 * Cleans comments feed input
			 */
			cleanCommentInput: function () {
				this.byId("CommentsFeedInput").setValue("");
			},

			/**
			 * Returns a user input from the comment box.
			 *
			 * @returns {string} text input from user.
			 */
			getValueFromCommentInput: function () {
				return this.byId("CommentsFeedInput").getValue().trim();
			},

			/**
			 * Whether comment module has unsaved changes.
			 *
			 * @returns {boolean} returns whether comment module has unsaved changes.
			 */
			isDirty: function () {
				return !!this.getValueFromCommentInput().length;
			},

			/**
			 * Binds Comment Type control by app source
			 */
			bindCommentType: function () {
				var oCommentType = this.byId("CommentType");

				oCommentType.bindItems({
					path    : this.getCommentTypePath(),
					template: new ListItem({
						key : "{VH>Value}",
						text: "{VH>Description}"
					})
				});
			},

			/**
			 * Returns the path for the binding of the 'CommentType' property based on the source app.
			 *
			 * @returns {string} the path for the binding of the 'CommentType' property based on the source app.
			 */
			getCommentTypePath: function () {
				return "VH>/consts/ValueHelpItem/*CREDINS*COMMENT_TYPE(Source=" + this.oParameters.source + ")";
			},

			/**
			 * Include the right mixing depending on the type of comment module (odata, json).
			 *
			 * @private
			 */
			_injectMixin: function () {
				// dynamic mixin including into the module, depending on the mode
				switch (this.oParameters.modelMode) {
					case ModuleMode.MODEL_MODE_ODATA: {
						jQuery.extend(true, this, CommentsODATAMixin);
						break;
					}
					case ModuleMode.MODEL_MODE_JSON: {
						jQuery.extend(true, this, CommentsJSONMixin);
						break;
					}

					default: {
						throw new Error("Unknown comments model mode!");
					}
				}
			},

			/**
			 * Internal init method.
			 *
			 * @private
			 */
			__init: function () {
				// dynamic "post" event handler attaching
				this.byId("CommentsFeedInput").detachPost(this.onPostComment, this);
				this.byId("CommentsFeedInput").attachPost(this.onPostComment, this);

				// in order to rerender comments, the parent app should directly fire the "updateMethod" event
				this.getView().detachEvent("updateModule", this._renderComments, this);
				this.getView().attachEvent("updateModule", this._renderComments, this);

				// call the mixin's init method
				this._init();
			},

			/**
			 * Post a comment, so either save it in client-side comments cache or OData model.
			 *
			 * @param {sap.ui.base.Event} oEvent event object
			 */
			onPostComment: function (oEvent) {
				this._postComment(oEvent.getParameter("value"));
			},

			/**
			 * Must be declared in mixins.
			 */
			forcePostComments: function () {
				throw "Must be declared!";
			},

			/**
			 * For the sake of UX, if user entered text in the comment box but not pressed on "Submit" button and then
			 * press on app's specific "Save" button, the comment that was not submitted should be automatically added.
			 */
			forceAddComment: function () {
				var sInputFromUser = this.getValueFromCommentInput();

				if (sInputFromUser.length) {
					this._postComment(sInputFromUser);
				}

				this.cleanCommentInput();
			},

			/**
			 * Returns the current value from the comment type selection on the screen.
			 *
			 * @returns {string} the comment type value
			 *
			 * @private
			 */
			_getCommentType: function () {
				return this.byId("CommentType").getSelectedKey();
			},

			/**
			 * Returns the current value from the comment type selection on the screen.
			 *
			 * @returns {string} the comment type value
			 *
			 * @private
			 */
			_getVisibility: function () {
				return this.byId("Visibility").getSelectedKey();
			},

			/**
			 * Destroy the comment list if exists.
			 *
			 * @private
			 */
			_destroyCommentsList: function () {
				var oLayout = this.byId(COMMENTS_LAYOUT_ID);

				var oCommentsList = this.byId(COMMENTS_LIST_ID);

				if (oCommentsList) {
					oLayout.removeContent(oCommentsList);
					oCommentsList.destroy();
				}
			},

			/**
			 * Wait until the parent binding context is set.
			 *
			 * @private
			 * @returns {Promise} Promise object
			 */
			_whenTheParentContextIsSet: function () {
				var that = this;

				return new Promise(function (resolve) {
					var iIntervalId = setInterval(function () {
						if (typeof that.getParentContext() === "undefined") {
							// continue requesting
						} else {
							clearInterval(iIntervalId);
							that.iParentContextSearchInterval = null;
							resolve();
						}
					}, PARENT_SEARCH_INTERVAL);

					// if cannot get context, then after 20 sec turn off getter of parent context
					setTimeout(function () {
						clearInterval(iIntervalId);
					}, PARENT_SEARCH_TIMEOUT);

					that.iParentContextSearchInterval = iIntervalId;
				});
			},

			/**
			 * Get the binding context of the parent object of the module.
			 *
			 * @returns {sap.ui.model.ContextBinding} the binding context of the parent object
			 */
			getParentContext: function () {
				var oView = this.getView();

				return oView.getParent().getBindingContext(this.oParameters.modelName);
			},

			/**
			 * Suspends might existing comments list binding
			 *
			 * @private
			 */
			_suspendComments: function () {
				var oCommentsList = this.byId(COMMENTS_LIST_ID);

				if (oCommentsList) {
					var oItemsBinding = oCommentsList.getBinding("items");
					oItemsBinding.suspend();
				}
			},

			/**
			 * Create a list for showing comments
			 *
			 * @param {Object} options the parameters required for reaction of the list
			 * @param {string} options.listItemPath the path to the list for binding
			 * @param {string} options.senderPath the path to the "sender" property
			 * @param {string} options.datePath the path to the "date" property
			 * @param {string} options.messagePath the path to the "message"
			 *
			 * @returns {sap.m.List} list for showing comments
			 *
			 * @private
			 */
			_createCommentsList: function (options) {
				var that = this;

				var oFeedListItemTemplateArguments = {
					showIcon : false,
					sender   : "{" + options.senderPath + "}",
					timestamp: {
						path         : options.datePath,
						type         : "sap.ui.model.type.Date",
						formatOptions: {
							style: "medium"
						}
					},
					text     : "{" + options.messagePath + "}",
					dependents: [
						new ContactCard()
					]
				};

				if (this.oParameters.useCommentType) {
					oFeedListItemTemplateArguments.info	= {
						parts: [
							{ path: options.commentTypePath },
							{ path: that.getCommentTypePath() }
						],
						formatter: this.rformatter.keyToVHDescription
					};
				}

				if (this.oParameters.visibility.enabled) {
					if (this.oParameters.visibility.conversionMode === "RAA") {
						this.oParameters.visibility.formatter = function(sType) {
							return sType === "InternalChat";
						};
						this.oParameters.visibility.parser = function(bInternal) {
							return bInternal ? "InternalChat" : "ExternalChat";
						};
					}
					oFeedListItemTemplateArguments.info	= {
						parts: [{
							model: this.oParameters.modelName,
							path: this.oParameters.visibility.path,
							formatter: this.oParameters.visibility.formatter
						}, "i18n>Internal_Comment", "i18n>External_Comment"],

						formatter: function(bInternal, sInternalText, sExternalText) {
							return bInternal ? sInternalText : sExternalText;
						}
					};
				} else if (this.oParameters.visibility.constantValue) {
					this.oParameters.visibility.parser = function() {
						return this.oParameters.visibility.constantValue;
					};
				}

				var oFeedListItemTemplate = new FeedListItem(oFeedListItemTemplateArguments);

				return new List(this.createId(COMMENTS_LIST_ID), {
					noDataText: "{i18n>CommentsNoData}",
					items     : {
						path    : options.listItemsPath,
						template: oFeedListItemTemplate,
						sorter  : this.getCommentsSorter()
					}
				});
			},

			/**
			 * Helper for returning the list of comments (control).
			 *
			 * @returns {sap.m.List} the comments list.
			 */
			getCommentsList: function () {
				return this.byId(COMMENTS_LIST_ID);
			},

			/**
			 * Returns a sorter for comments list.
			 *
			 * @returns {sap.ui.model.Sorter} the sorter instance.
			 */
			getCommentsSorter: function () {
				return new Sorter("Date", true);
			},

			/**
			 * Checks is the comments feed input in dirty state
			 *
			 * @returns {boolean} result of check on dirty state
			 */
			isCommentsFeedInputInDirtyState: function () {
				return !!this.byId("CommentsFeedInput").getValue();
			},

			/**
			 * Exit lifecycle event.
			 */
			onExit: function () {
				// it's needed to reset the flag after "exit" event of controller, because the procedure of enhancing
				// should be repeated after the next entering the app.
				bIsi18nEnhanced = false;

				// flush the interval for searching the parent context (to prevent the interval leak)
				if (this.iParentContextSearchInterval) {
					clearInterval(this.iParentContextSearchInterval);
				}

				if (this._onExit) {
					this._onExit();
				}
			}
		});
	}
);